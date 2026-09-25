import {
  AccountRole, address, createNoopSigner, createSolanaRpc, isSignerRole, isWritableRole,
  type Instruction as KitInstruction,
} from '@solana/kit';
import {
  KaminoAction, KaminoMarket, KaminoObligation, VanillaObligation, getCurrentLedgerInstant,
} from '@kamino-finance/klend-sdk';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID, ExtensionType, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync, getDefaultAccountState, getExtensionTypes, getMint,
  getAccountLenForMint, getPausableConfig, getPermanentDelegate, getScaledUiAmountConfig, getTransferHook,
} from '@solana/spl-token';
import { Connection, PublicKey, SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { Decimal } from 'decimal.js';
import { KAMINO_MARKET_ADDRESS, KAMINO_PROGRAM_ADDRESS, USDC_MINT_ADDRESS, USDC_RESERVE_ADDRESS, type LendingActionKind, type LendingObligation, type LendingRiskPreview, type LendingWalletHolding } from '@warren/lending-contract';
import { KAMINO_XSTOCK_ASSETS, type AssetIdentity } from './market.js';
import type { LendingStepKind } from '@warren/lending-contract';

const U64_MAX = '18446744073709551615';
const expectedMintExtensions = new Set([
  ExtensionType.PermanentDelegate, ExtensionType.DefaultAccountState,
  ExtensionType.ScaledUiAmountConfig, ExtensionType.TransferHook,
  ExtensionType.MetadataPointer, ExtensionType.PausableConfig,
  ExtensionType.ConfidentialTransferMint, ExtensionType.TokenMetadata,
]);

export class KaminoSdkFault extends Error {
  constructor(message: string, readonly status = 422, readonly retryable = false) { super(message); }
}

export class KaminoSdkAdapter {
  private readonly rpc: ReturnType<typeof createSolanaRpc>;
  private readonly connection: Connection;
  constructor(private readonly options: { rpcUrl: string; timeoutMs: number }) {
    this.rpc = createSolanaRpc(options.rpcUrl);
    this.connection = new Connection(options.rpcUrl, {
      commitment: 'confirmed',
      fetch: async (input, init) => {
        const timeout = AbortSignal.timeout(options.timeoutMs);
        const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
        return fetch(input, { ...init, signal });
      },
    });
  }

  async readWallet(walletAddress: string) {
    const wallet = new PublicKey(walletAddress);
    const [classicAccounts, token2022Accounts, mints] = await Promise.all([
      this.connection.getParsedTokenAccountsByOwner(wallet, { programId: TOKEN_PROGRAM_ID }, 'confirmed'),
      this.connection.getParsedTokenAccountsByOwner(wallet, { programId: TOKEN_2022_PROGRAM_ID }, 'confirmed'),
      Promise.all(KAMINO_XSTOCK_ASSETS.map((asset) => this.readMint(asset))),
    ]);
    const market = await KaminoMarket.load(this.rpc, address(KAMINO_MARKET_ADDRESS), optionsRecentSlotDurationMs, address(KAMINO_PROGRAM_ADDRESS), true);
    if (!market) throw new KaminoSdkFault('Kamino xStocks market could not be loaded.', 503, true);
    const currentLedgerInstant = await getCurrentLedgerInstant(this.rpc, 'confirmed');
    const accountRows = [
      ...classicAccounts.value.map((row) => ({ row, tokenProgram: 'spl-token' as const })),
      ...token2022Accounts.value.map((row) => ({ row, tokenProgram: 'token-2022' as const })),
    ];
    const holdings = KAMINO_XSTOCK_ASSETS.map((asset, index) => this.holding(asset, mints[index]!, accountRows, wallet));
    const obligations = await market.getAllUserObligations(address(wallet.toBase58()), currentLedgerInstant);
    const positions = await Promise.all(obligations.map((obligation) => this.position(market, obligation, currentLedgerInstant, obligations.length > 1)));
    const usdcAccounts = accountRows.flatMap(({ row }) => {
      const parsed = (row.account.data.parsed as { info?: { mint?: string; owner?: string; state?: string; tokenAmount?: { amount?: string } } } | undefined)?.info;
      if (!parsed || parsed.mint !== USDC_MINT_ADDRESS || parsed.owner !== wallet.toBase58()) return [];
      const amount = parsed.tokenAmount?.amount;
      if (!amount || !/^\d+$/.test(amount)) throw new KaminoSdkFault('USDC token account data is invalid.');
      return [{ address: row.pubkey, amount, frozen: parsed.state === 'frozen' }];
    });
    const usdcAta = getAssociatedTokenAddressSync(new PublicKey(USDC_MINT_ADDRESS), wallet, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
    const usdcRaw = usdcAccounts.reduce((sum, account) => sum + BigInt(account.amount), 0n);
    const usdcSpendable = usdcAccounts.filter((account) => !account.frozen && account.address.equals(usdcAta)).reduce((sum, account) => sum + BigInt(account.amount), 0n);
    return {
      walletAddress: wallet.toBase58(), network: 'solana-mainnet' as const, observedAt: new Date().toISOString(), holdings, obligations: positions,
      usdcBalance: { mintAddress: USDC_MINT_ADDRESS, rawAmount: usdcRaw.toString(), spendableRawAmount: usdcSpendable.toString(), decimals: 6 as const,
        displayAmount: decimalFromRaw(usdcSpendable.toString(), 6), sourceAccountAddress: usdcSpendable > 0n ? usdcAta.toBase58() : null },
    };
  }

  async preview(input: { walletAddress: string; asset: AssetIdentity; action: LendingActionKind; amountRaw: string; secondaryAmountRaw?: string; headroomBps: number }) {
    const wallet = address(new PublicKey(input.walletAddress).toBase58());
    const market = await KaminoMarket.load(this.rpc, address(KAMINO_MARKET_ADDRESS), optionsRecentSlotDurationMs, address(KAMINO_PROGRAM_ADDRESS), true);
    if (!market) throw new KaminoSdkFault('Kamino xStocks market could not be loaded.', 503, true);
    const currentLedgerInstant = await getCurrentLedgerInstant(this.rpc, 'confirmed');
    const collateralReserveAddress = address(input.asset.reserve);
    const debtReserveAddress = address(USDC_RESERVE_ADDRESS);
    const collateralReserve = market.reserves.get(collateralReserveAddress);
    const debtReserve = market.reserves.get(debtReserveAddress);
    if (!collateralReserve || !debtReserve || collateralReserve.getLiquidityMint() !== address(input.asset.mint) || debtReserve.getLiquidityMint() !== address(USDC_MINT_ADDRESS)) {
      throw new KaminoSdkFault('On-chain reserve identities do not match the pinned xStock and USDC pair.');
    }
    if (!collateralReserve.hasValidOraclePrice() || !debtReserve.hasValidOraclePrice()) throw new KaminoSdkFault('A current oracle price was not provided.');
    const obligations = await market.getAllUserObligations(wallet, currentLedgerInstant);
    if (obligations.length > 1) throw new KaminoSdkFault('Multiple Kamino obligations are visible; Warren has not validated actions across more than one obligation.');
    if (obligations.some((item) => item.obligationTag !== VanillaObligation.tag)) throw new KaminoSdkFault('Non-vanilla Kamino positions are visible but Warren has not validated actions for them.');
    const obligation = obligations.find((item) => item.obligationTag === VanillaObligation.tag);
    if (obligation && !supportedObligation(obligation, input.asset, market)) throw new KaminoSdkFault('Mixed Kamino obligations are visible but their actions are not validated.');
    const firstRaw = input.amountRaw;
    const secondRaw = input.secondaryAmountRaw ?? '0';
    const debtRaw = input.action === 'supply-borrow' ? secondRaw
      : input.action === 'borrow' || input.action === 'repay' || input.action === 'repay-withdraw'
        ? firstRaw === 'ALL' && obligation ? obligation.getBorrowAmountByReserve(debtReserve).toFixed(0, Decimal.ROUND_DOWN) : firstRaw : '0';
    const supplyRaw = input.action === 'supply' || input.action === 'supply-borrow' ? firstRaw : '0';
    let withdrawRaw = input.action === 'withdraw' ? firstRaw : input.action === 'repay-withdraw' ? secondRaw : '0';
    if (withdrawRaw === 'ALL') {
      if (!obligation) throw new KaminoSdkFault('There is no supported Kamino collateral to withdraw.');
      withdrawRaw = (input.action === 'repay-withdraw'
        ? obligation.getMaxWithdrawAmountWithRepay(market, collateralReserveAddress, currentLedgerInstant, new Decimal(debtRaw), debtReserveAddress).maxWithdrawAmount
        : obligation.getMaxWithdrawAmount(market, collateralReserveAddress, currentLedgerInstant).maxWithdrawAmount).toFixed(0, Decimal.ROUND_DOWN);
    }
    for (const value of [supplyRaw, debtRaw, withdrawRaw]) if (!/^\d+$/.test(value)) throw new KaminoSdkFault('The raw amount must be an unsigned integer.');
    const collateralChange = new Decimal(supplyRaw || '0').minus(withdrawRaw || '0');
    const debtChange = input.action === 'repay' || input.action === 'repay-withdraw'
      ? new Decimal(debtRaw || '0').negated() : new Decimal(debtRaw || '0');
    const elevationGroup = obligation?.state.elevationGroup ?? 0;
    const baseDeposits = obligation?.state.deposits ?? [];
    const baseBorrows = obligation?.state.borrows ?? [];
    const sdkAction = input.action === 'supply-borrow' ? 'depositAndBorrow' as const
      : input.action === 'supply' ? 'deposit' as const
        : input.action === 'borrow' ? 'borrow' as const
          : input.action === 'repay' || input.action === 'repay-withdraw' ? 'repay' as const : 'withdraw' as const;
    let projectedStats = KaminoObligation.simulateObligationStats({
      baseDeposits, baseBorrows, elevationGroup,
      ...(supplyRaw !== '0' ? { amountCollateral: new Decimal(supplyRaw), collateralReserveAddress }
        : withdrawRaw !== '0' ? { amountCollateral: new Decimal(withdrawRaw), collateralReserveAddress } : {}),
      ...(debtRaw !== '0' ? { amountDebt: new Decimal(debtRaw), debtReserveAddress } : {}),
      action: sdkAction, market, currentLedgerInstant,
    }).stats;
    if (input.action === 'repay-withdraw') {
      if (!obligation) throw new KaminoSdkFault('There is no supported Kamino obligation to repay and withdraw.');
      const afterRepay = obligation.withPositionChanges(market, currentLedgerInstant, undefined, [{ reserveAddress: debtReserveAddress, amountChangeLamports: debtChange }]);
      projectedStats = afterRepay.withPositionChanges(market, currentLedgerInstant, [{ reserveAddress: collateralReserveAddress, amountChangeLamports: new Decimal(withdrawRaw).negated() }]).refreshedStats;
    }
    const depositOnlyStats = !obligation && supplyRaw !== '0' ? KaminoObligation.simulateObligationStats({
      baseDeposits, baseBorrows, elevationGroup, amountCollateral: new Decimal(supplyRaw), collateralReserveAddress,
      action: 'deposit', market, currentLedgerInstant,
    }).stats : undefined;
    const maxBorrowRaw = obligation
      ? (supplyRaw !== '0'
        ? obligation.getMaxBorrowAmountV2WithDeposit(market, debtReserveAddress, currentLedgerInstant, elevationGroup, new Decimal(supplyRaw), collateralReserveAddress)
        : obligation.getMaxBorrowAmountV2(market, debtReserveAddress, currentLedgerInstant, elevationGroup)).toFixed(0, Decimal.ROUND_DOWN)
      : (depositOnlyStats?.borrowLimit ?? projectedStats.borrowLimit).div(debtReserve.getValidOracleMarketPrice()).mul(new Decimal(10).pow(debtReserve.getMintDecimals())).toFixed(0, Decimal.ROUND_DOWN);
    const safeBorrowRaw = new Decimal(maxBorrowRaw).mul(input.headroomBps).div(10_000).floor().toFixed(0);
    const maxWithdrawRaw = obligation
      ? input.action === 'repay-withdraw'
        ? obligation.getMaxWithdrawAmountWithRepay(market, collateralReserveAddress, currentLedgerInstant, new Decimal(debtRaw), debtReserveAddress).maxWithdrawAmount.toFixed(0, Decimal.ROUND_DOWN)
        : obligation.getMaxWithdrawAmount(market, collateralReserveAddress, currentLedgerInstant).maxWithdrawAmount.toFixed(0, Decimal.ROUND_DOWN)
      : '0';
    const currentDebt = obligation?.getBorrowAmountByReserve(debtReserve).toFixed(0, Decimal.ROUND_DOWN) ?? '0';
    const currentCollateral = obligation?.getDepositAmountByReserve(collateralReserve).toFixed(0, Decimal.ROUND_DOWN) ?? '0';
    const actionAmount = input.action === 'supply-borrow' ? debtRaw : input.action === 'supply' ? supplyRaw : input.action === 'withdraw' ? withdrawRaw : debtRaw;
    const violation = input.action === 'borrow' || input.action === 'supply-borrow'
      ? new Decimal(actionAmount).gt(safeBorrowRaw) ? 'The requested USDC amount exceeds the Kamino SDK borrow headroom after Warren’s safety buffer.' : null
      : input.action === 'withdraw' || input.action === 'repay-withdraw'
        ? new Decimal(withdrawRaw).gt(maxWithdrawRaw) ? 'The requested withdrawal exceeds the Kamino SDK safe withdraw amount.' : null
        : null;
    return {
      walletAddress: wallet, assetId: input.asset.assetId, action: input.action,
      observedAt: new Date().toISOString(), obligationAddress: obligation?.obligationAddress ?? null,
      collateralRawBefore: currentCollateral,
      collateralRawAfter: Decimal.max(new Decimal(currentCollateral).plus(collateralChange), 0).toFixed(0, Decimal.ROUND_DOWN),
      debtRawBefore: currentDebt,
      debtRawAfter: Decimal.max(new Decimal(currentDebt).plus(debtChange), 0).toFixed(0, Decimal.ROUND_DOWN),
      maxBorrowRaw: safeBorrowRaw, maxWithdrawRaw,
      currentLtv: obligation?.refreshedStats.loanToValue.toString() ?? '0',
      projectedLtv: projectedStats.loanToValue.toString(), liquidationLtv: projectedStats.liquidationLtv.toString(),
      liquidationHeadroomUsd: projectedStats.borrowLiquidationLimit.minus(projectedStats.userTotalBorrowBorrowFactorAdjusted).toString(),
      supplyApy: null, borrowApy: null, availableLiquidity: null,
      healthBufferBps: input.headroomBps, approvalCount: input.action === 'supply-borrow' || input.action === 'repay-withdraw' ? 2 : 1,
      newRiskPaused: false, actionAvailable: violation === null, blockReason: violation,
    } satisfies LendingRiskPreview;
  }

  async prepare(input: {
    walletAddress: string; asset: AssetIdentity; kind: LendingStepKind; amountRaw: string;
  }): Promise<{ unsignedTransaction: string; lastValidBlockHeight: number; expiresAt: string; amountRaw: string; amount: string; displayAmount: string; decimals: number; feeEstimateLamports: string | null; rentEstimateLamports: string | null; simulation: { ok: boolean; unitsConsumed: number | null; logs: string[]; error: string | null } }> {
    if (!/^\d+$/.test(input.amountRaw) || BigInt(input.amountRaw) <= 0n || BigInt(input.amountRaw) > BigInt(U64_MAX)) {
      throw new KaminoSdkFault('The requested raw amount is outside the supported range.');
    }
    const ownerAddress = address(new PublicKey(input.walletAddress).toBase58());
    const owner = createNoopSigner(ownerAddress);
    const market = await KaminoMarket.load(this.rpc, address(KAMINO_MARKET_ADDRESS), optionsRecentSlotDurationMs, address(KAMINO_PROGRAM_ADDRESS), true);
    const currentLedgerInstant = await getCurrentLedgerInstant(this.rpc, 'confirmed');
    if (!market || market.programId !== address(KAMINO_PROGRAM_ADDRESS)) throw new KaminoSdkFault('Kamino market identity could not be verified.', 503, true);
    const collateralReserve = market.reserves.get(address(input.asset.reserve));
    const debtReserve = market.reserves.get(address(USDC_RESERVE_ADDRESS));
    if (!collateralReserve || collateralReserve.getLiquidityMint() !== address(input.asset.mint) || !debtReserve || debtReserve.getLiquidityMint() !== address(USDC_MINT_ADDRESS)) {
      throw new KaminoSdkFault('The on-chain collateral and USDC reserve identities do not match the pinned market.');
    }
    if (!collateralReserve.hasValidOraclePrice() || !debtReserve.hasValidOraclePrice()) throw new KaminoSdkFault('A current oracle price was not provided.');
    const obligations = await market.getAllUserObligations(ownerAddress, currentLedgerInstant);
    if (obligations.length > 1) throw new KaminoSdkFault('Multiple Kamino obligations are visible; Warren has not validated actions across more than one obligation.');
    const vanilla = obligations.find((obligation) => obligation.obligationTag === VanillaObligation.tag);
    const obligation = vanilla ?? new VanillaObligation(address(KAMINO_PROGRAM_ADDRESS));
    if (vanilla && !supportedObligation(vanilla, input.asset, market)) {
      throw new KaminoSdkFault('This mixed Kamino obligation is visible, but Warren has not validated actions for it.');
    }

    const common = {
      kaminoMarket: market, amount: input.amountRaw, owner, obligation, currentLedgerInstant,
      includeAtaIxs: true, scopeRefreshConfig: undefined, useV2Ixs: true,
      initUserMetadata: { skipInitialization: false, skipLutCreation: true },
    };
    const built = input.kind === 'supply'
      ? await KaminoAction.buildDepositTxns({ ...common, reserveAddress: address(input.asset.reserve) })
      : input.kind === 'borrow'
        ? await KaminoAction.buildBorrowTxns({ ...common, reserveAddress: address(USDC_RESERVE_ADDRESS) })
        : input.kind === 'repay'
          ? await KaminoAction.buildRepayTxns({ ...common, reserveAddress: address(USDC_RESERVE_ADDRESS) })
          : await KaminoAction.buildWithdrawTxns({ ...common, reserveAddress: address(input.asset.reserve) });

    const expectedPrimary = {
      supply: 'depositReserveLiquidityAndObligationCollateral',
      borrow: 'borrowObligationLiquidity', repay: 'repayObligationLiquidity', withdraw: 'withdrawObligationCollateral',
    }[input.kind];
    if (!built.lendingIxsLabels.some((label) => label.startsWith(expectedPrimary))) {
      throw new KaminoSdkFault('The pinned Kamino SDK did not build the expected obligation action.');
    }
    const primaryInstructions = built.lendingIxs.filter((_, index) => built.lendingIxsLabels[index]?.startsWith(expectedPrimary));
    if (primaryInstructions.length !== 1) throw new KaminoSdkFault('Kamino returned an unexpected number of primary instructions.');
    const obligationAddress = await new VanillaObligation(address(KAMINO_PROGRAM_ADDRESS)).toPda(address(KAMINO_MARKET_ADDRESS), ownerAddress);
    const primary = primaryInstructions[0]!;
    const primaryAccounts = new Set((primary.accounts ?? []).flatMap((account) => account.address ? [account.address] : []));
    if (!primaryAccounts.has(ownerAddress) || !primaryAccounts.has(address(KAMINO_MARKET_ADDRESS))
      || !primaryAccounts.has(input.kind === 'borrow' || input.kind === 'repay' ? address(USDC_RESERVE_ADDRESS) : address(input.asset.reserve))
      || !primaryAccounts.has(obligationAddress)) {
      throw new KaminoSdkFault('The Kamino instruction does not contain the selected wallet, market, reserve and obligation.');
    }

    const instructions = [
      ...built.computeBudgetIxs, ...built.setupIxs, ...built.inBetweenIxs,
      ...built.lendingIxs, ...built.postLendingIxs, ...built.cleanupIxs, ...built.refreshFarmsCleanupTxnIxs,
    ];
    if (!instructions.length || instructions.some((ix) => ix.programAddress !== address(KAMINO_PROGRAM_ADDRESS)
      && ![TOKEN_PROGRAM_ID.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58(), ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(), 'ComputeBudget111111111111111111111111111111'].includes(ix.programAddress))) {
      throw new KaminoSdkFault('Kamino returned an instruction from an unexpected program.');
    }
    const web3Instructions = instructions.map((instruction) => toWeb3Instruction(instruction as KitInstruction));
    const lookups = await Promise.all(built.luts.map(async (lutAddress) => {
      const response = await this.connection.getAddressLookupTable(new PublicKey(lutAddress), { commitment: 'confirmed' });
      if (!response.value) throw new KaminoSdkFault('A required address lookup table could not be loaded.', 503, true);
      return response.value;
    }));
    const blockhash = await this.connection.getLatestBlockhash('confirmed');
    const currentBlockHeight = await this.connection.getBlockHeight('confirmed');
    if (currentBlockHeight > blockhash.lastValidBlockHeight) throw new KaminoSdkFault('The blockhash expired before the unsigned review could be prepared.', 409);
    const transaction = new VersionedTransaction(new TransactionMessage({
      payerKey: new PublicKey(ownerAddress), recentBlockhash: blockhash.blockhash, instructions: web3Instructions,
    }).compileToV0Message(lookups));
    const requiredSigners = instructions.flatMap((instruction) => (instruction.accounts ?? [])
      .filter((meta) => isSignerRole(meta.role)).map((meta) => meta.address));
    if (new Set(requiredSigners).size !== 1 || requiredSigners[0] !== ownerAddress) {
      throw new KaminoSdkFault('The transaction requests a signer outside the selected Warren wallet.');
    }
    const simulation = await this.connection.simulateTransaction(transaction, { sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed' });
    const simulationResult = {
      ok: simulation.value.err === null,
      unitsConsumed: simulation.value.unitsConsumed ?? null,
      logs: (simulation.value.logs ?? []).slice(-40),
      error: simulation.value.err === null ? null : JSON.stringify(simulation.value.err),
    };
    if (!simulationResult.ok) throw new KaminoSdkFault('The unsigned transaction did not pass current RPC simulation.');
    let feeEstimateLamports: string | null = null;
    let rentEstimate = 0n;
    // The SDK may create a Kamino metadata/obligation PDA on supply. Without an
    // exact rent quote for that account, disclose the rent component as unknown.
    let rentKnown = input.kind !== 'supply';
    try {
      const fee = await this.connection.getFeeForMessage(transaction.message, 'confirmed');
      if (fee.value !== null) feeEstimateLamports = String(fee.value);
    } catch { /* A missing fee quote is disclosed as unavailable in the review. */ }
    if (input.kind === 'borrow' || input.kind === 'withdraw') {
      const receiveMintAddress = input.kind === 'borrow' ? USDC_MINT_ADDRESS : input.asset.mint;
      const receiveMintKey = new PublicKey(receiveMintAddress);
      const receiveMintAccount = await this.connection.getAccountInfo(receiveMintKey, 'confirmed');
      if (!receiveMintAccount || ![TOKEN_PROGRAM_ID.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58()].includes(receiveMintAccount.owner.toBase58())) {
        throw new KaminoSdkFault('The destination token mint could not be verified.');
      }
      const receiveMint = await getMint(this.connection, receiveMintKey, 'confirmed', receiveMintAccount.owner);
      const receiveProgram = receiveMintAccount.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
      const receiveAta = getAssociatedTokenAddressSync(receiveMintKey, new PublicKey(ownerAddress), false, receiveProgram, ASSOCIATED_TOKEN_PROGRAM_ID);
      if (!(await this.connection.getAccountInfo(receiveAta, 'confirmed'))) {
        rentEstimate += BigInt(await this.connection.getMinimumBalanceForRentExemption(getAccountLenForMint(receiveMint), 'confirmed'));
      }
    }
    const reserve = input.kind === 'borrow' || input.kind === 'repay' ? debtReserve : collateralReserve;
    const amount = (new Decimal(input.amountRaw).div(new Decimal(10).pow(reserve.getMintDecimals()))).toString();
    const mintInfo = await this.readMint(input.asset);
    const multiplier = mintInfo.scaledMultiplier ?? '1';
    const displayAmount = new Decimal(amount).mul(multiplier).toString();
    return {
      unsignedTransaction: Buffer.from(transaction.serialize()).toString('base64'),
      lastValidBlockHeight: blockhash.lastValidBlockHeight,
      expiresAt: new Date(Date.now() + Math.min(60_000, Math.max(1_000, (blockhash.lastValidBlockHeight - currentBlockHeight) * 400))).toISOString(),
      amountRaw: input.amountRaw, amount, displayAmount, decimals: reserve.getMintDecimals(), simulation: simulationResult,
      feeEstimateLamports, rentEstimateLamports: rentKnown ? rentEstimate.toString() : null,
    };
  }

  async send(signedTransaction: string): Promise<string> {
    let transaction: VersionedTransaction;
    try { transaction = VersionedTransaction.deserialize(Buffer.from(signedTransaction, 'base64')); }
    catch { throw new KaminoSdkFault('The signed transaction could not be decoded.'); }
    return this.connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false, maxRetries: 0, preflightCommitment: 'confirmed',
    });
  }

  async isBlockhashExpired(lastValidBlockHeight: number): Promise<boolean> {
    return await this.connection.getBlockHeight('confirmed') > lastValidBlockHeight;
  }

  async getSignatureState(signature: string): Promise<'confirmed' | 'failed' | 'pending' | 'unknown'> {
    try {
      const result = await this.connection.getSignatureStatuses([signature], { searchTransactionHistory: true });
      const status = result.value[0];
      if (!status) return 'unknown';
      if (status.err) return 'failed';
      if (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized') return 'confirmed';
      return 'pending';
    } catch { return 'unknown'; }
  }

  private async readMint(asset: AssetIdentity) {
    const mint = new PublicKey(asset.mint);
    const account = await this.connection.getAccountInfo(mint, 'confirmed');
    if (!account) return { mint: null, supported: false, scaledMultiplier: null as string | null, tokenProgram: null as 'spl-token' | 'token-2022' | null };
    const token2022 = account.owner.equals(TOKEN_2022_PROGRAM_ID);
    if (!token2022 && !account.owner.equals(TOKEN_PROGRAM_ID)) return { mint: null, supported: false, scaledMultiplier: null as string | null, tokenProgram: null as 'spl-token' | 'token-2022' | null };
    const decoded = await getMint(this.connection, mint, 'confirmed', account.owner);
    if (!token2022) return { mint: decoded, supported: decoded.decimals === 6 || decoded.decimals === 8, scaledMultiplier: null as string | null, tokenProgram: 'spl-token' as const };
    const extensionTypes = getExtensionTypes(decoded.tlvData);
    const unknownExtension = extensionTypes.some((type) => !expectedMintExtensions.has(type));
    const hasScaledUiAmount = extensionTypes.includes(ExtensionType.ScaledUiAmountConfig);
    const hasPermanentDelegate = extensionTypes.includes(ExtensionType.PermanentDelegate);
    const defaultState = getDefaultAccountState(decoded);
    const transferHook = getTransferHook(decoded);
    const pausable = getPausableConfig(decoded);
    const supported = !unknownExtension && hasScaledUiAmount && hasPermanentDelegate
      && defaultState?.state === 1 && (!transferHook || transferHook.programId === null || transferHook.programId.equals(SystemProgram.programId))
      && (!pausable || !pausable.paused) && decoded.decimals === 8;
    const scaled = getScaledUiAmountConfig(decoded);
    const activeMultiplier = scaled && Number(scaled.newMultiplierEffectiveTimestamp) <= Math.floor(Date.now() / 1_000)
      ? scaled.newMultiplier : scaled?.multiplier;
    return { mint: decoded, supported, scaledMultiplier: activeMultiplier === undefined ? null : String(activeMultiplier), tokenProgram: 'token-2022' as const };
  }

  private holding(asset: AssetIdentity, mintInfo: Awaited<ReturnType<KaminoSdkAdapter['readMint']>>, rows: Array<{ row: { pubkey: PublicKey; account: { data: { parsed: unknown } } }; tokenProgram: 'spl-token' | 'token-2022' }>, wallet: PublicKey): LendingWalletHolding {
    const accounts = rows.flatMap(({ row, tokenProgram }) => {
      const parsed = (row.account.data.parsed as { info?: { mint?: string; owner?: string; state?: string; tokenAmount?: { amount?: string; decimals?: number } } } | undefined)?.info;
      if (!parsed || parsed.mint !== asset.mint || parsed.owner !== wallet.toBase58()) return [];
      const amount = parsed.tokenAmount?.amount;
      const decimals = parsed.tokenAmount?.decimals;
      if (!amount || !/^\d+$/.test(amount) || decimals === undefined) throw new KaminoSdkFault('Token account data is invalid.');
      return [{ address: row.pubkey, amount, decimals, frozen: parsed.state === 'frozen', tokenProgram }];
    });
    const total = accounts.reduce((sum, account) => sum + BigInt(account.amount), 0n);
    const tokenProgramId = mintInfo.tokenProgram === 'token-2022' ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
    const ata = mintInfo.mint ? getAssociatedTokenAddressSync(new PublicKey(asset.mint), wallet, false,
      tokenProgramId, ASSOCIATED_TOKEN_PROGRAM_ID) : null;
    const spendable = accounts.filter((account) => !account.frozen && ata?.equals(account.address)).reduce((sum, account) => sum + BigInt(account.amount), 0n);
    const decimals = accounts[0]?.decimals ?? mintInfo.mint?.decimals ?? 8;
    const amount = decimalFromRaw(total.toString(), decimals);
    const multiplier = mintInfo.scaledMultiplier ?? '1';
    const displayAmount = new Decimal(amount).mul(multiplier).toString();
    return {
      assetId: asset.assetId, symbol: asset.symbol, mintAddress: asset.mint,
      rawAmount: total.toString(), spendableRawAmount: spendable.toString(), decimals,
      displayAmount, scaledUiMultiplier: mintInfo.scaledMultiplier,
      sourceAccountAddress: spendable > 0n ? ata?.toBase58() ?? null : null,
      accountCount: accounts.length, frozenAccountCount: accounts.filter((account) => account.frozen).length,
      tokenProgram: accounts[0]?.tokenProgram ?? mintInfo.tokenProgram ?? 'token-2022',
      extensionState: mintInfo.mint === null ? 'unavailable' : mintInfo.supported ? 'verified' : 'unsupported',
      eligibility: spendable > 0n && mintInfo.supported ? 'supported-balance' : total > 0n ? 'unsupported-account' : 'no-holding',
    };
  }

  private async position(market: KaminoMarket, obligation: Awaited<ReturnType<KaminoMarket['getAllUserObligations']>>[number], currentLedgerInstant: Awaited<ReturnType<typeof getCurrentLedgerInstant>>, multipleObligations = false): Promise<LendingObligation> {
    const collateral = await Promise.all(obligation.getDeposits().map((position) => this.positionLeg(market, position)));
    const debt = await Promise.all(obligation.getBorrows().map((position) => this.positionLeg(market, position)));
    const debtReserve = market.reserves.get(address(USDC_RESERVE_ADDRESS));
    const maxBorrowRaw = debtReserve && obligation.obligationTag === VanillaObligation.tag && debtReserve.hasValidOraclePrice()
      ? obligation.getMaxBorrowAmountV2(market, address(USDC_RESERVE_ADDRESS), currentLedgerInstant, obligation.state.elevationGroup).toString()
      : '0';
    const maxBorrowUsd = debtReserve ? new Decimal(maxBorrowRaw).div(new Decimal(10).pow(debtReserve.getMintDecimals())).mul(debtReserve.getValidOracleMarketPrice()).toString() : '0';
    const supportedReserves = new Set([...KAMINO_XSTOCK_ASSETS.map((asset) => asset.reserve), USDC_RESERVE_ADDRESS]);
    const collateralAssetReserves = obligation.getDepositReserves().filter((reserveAddress) => KAMINO_XSTOCK_ASSETS.some((asset) => asset.reserve === reserveAddress));
    const supported = !multipleObligations && obligation.obligationTag === VanillaObligation.tag
      && obligation.getAllReserves().every((reserveAddress) => supportedReserves.has(reserveAddress))
      && collateralAssetReserves.length <= 1
      && obligation.getBorrowReserves().every((reserveAddress) => reserveAddress === address(USDC_RESERVE_ADDRESS));
    return {
      obligationAddress: obligation.obligationAddress, obligationType: String(obligation.obligationTag),
      elevationGroup: obligation.state.elevationGroup, collateral, debt,
      netAccountValueUsd: obligation.refreshedStats.netAccountValue.toString(),
      ltv: obligation.refreshedStats.loanToValue.toString(), liquidationLtv: obligation.refreshedStats.liquidationLtv.toString(),
      maxBorrowUsd, borrowLimitUsd: obligation.refreshedStats.borrowLimit.toString(),
      liquidationLimitUsd: obligation.refreshedStats.borrowLiquidationLimit.toString(),
      supportedForActions: supported, actionBlockReason: supported ? null : multipleObligations
        ? 'Multiple obligations are visible; Warren has not validated actions across more than one obligation.'
        : 'Mixed or non-vanilla Kamino position; use the protocol interface to manage it.',
    };
  }

  private async positionLeg(market: KaminoMarket, position: { reserveAddress: string; mintAddress: string; amount: Decimal; marketValueRefreshed: Decimal }) {
    const reserve = market.reserves.get(address(position.reserveAddress));
    if (!reserve) throw new KaminoSdkFault('Kamino position references an unloaded reserve.', 503, true);
    const amount = position.amount.div(new Decimal(10).pow(reserve.getMintDecimals()));
    const asset = KAMINO_XSTOCK_ASSETS.find((candidate) => candidate.mint === position.mintAddress);
    const mintInfo = asset ? await this.readMint(asset) : undefined;
    const multiplier = mintInfo?.scaledMultiplier ?? null;
    const displayAmount = multiplier ? amount.mul(multiplier).toString() : amount.toString();
    return {
      reserveAddress: position.reserveAddress, mintAddress: position.mintAddress,
      rawAmount: position.amount.toFixed(0, Decimal.ROUND_DOWN), decimals: reserve.getMintDecimals(),
      amount: amount.toString(), displayAmount, scaledUiMultiplier: multiplier,
      marketValueUsd: position.marketValueRefreshed.toString(),
    };
  }
}

const optionsRecentSlotDurationMs = 30_000;
function supportedObligation(obligation: Awaited<ReturnType<KaminoMarket['getAllUserObligations']>>[number], asset: AssetIdentity, market: KaminoMarket) {
  return obligation.obligationTag === VanillaObligation.tag
    && obligation.getAllReserves().every((reserve) => reserve === address(asset.reserve) || reserve === address(USDC_RESERVE_ADDRESS))
    && [...obligation.getDepositReserves(), ...obligation.getBorrowReserves()].every((reserve) => market.reserves.has(reserve));
}
function decimalFromRaw(raw: string, decimals: number) { return new Decimal(raw).div(new Decimal(10).pow(decimals)).toString(); }
function toWeb3Instruction(instruction: KitInstruction): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(instruction.programAddress),
    keys: (instruction.accounts ?? []).map((account) => ({
      pubkey: new PublicKey(account.address), isSigner: isSignerRole(account.role), isWritable: isWritableRole(account.role),
    })),
    data: Buffer.from(instruction.data ?? new Uint8Array()),
  });
}
