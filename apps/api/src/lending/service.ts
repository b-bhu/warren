import { randomUUID } from 'node:crypto';
import { PublicKey, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { Decimal } from 'decimal.js';
import {
  lendingCatalogResponseSchema, lendingReviewSchema, lendingRiskPreviewSchema,
  lendingActionHistoryResponseSchema, lendingStepResultSchema, lendingWalletResponseSchema,
  type LendingActionCreate, type LendingActionKind, type LendingReview, type LendingRiskPreview,
  type LendingStepKind, type LendingStepResult, type LendingWalletResponse,
} from '@warren/lending-contract';
import type { ExecutionIdentity } from '../execution/types.js';
import { KAMINO_XSTOCK_ASSETS, KaminoMarketCatalog, type AssetIdentity } from './market.js';
import { KaminoSdkAdapter, KaminoSdkFault } from './kamino-sdk.js';
import { MemoryLendingActionStore, type LendingAction, type LendingActionStore, type LendingStep } from './store.js';

const idempotencyPattern = /^[A-Za-z0-9._:-]{16,128}$/;
const U64_MAX = 18_446_744_073_709_551_615n;

export type LendingFlags = { catalogEnabled: boolean; newRiskEnabled: boolean; repayEnabled: boolean; withdrawEnabled: boolean; borrowHeadroomBps: number };

export class LendingServiceFault extends Error {
  constructor(readonly code: 'LENDING_ACTION_PAUSED' | 'LENDING_PROVIDER_UNAVAILABLE' | 'LENDING_NOT_FOUND' | 'LENDING_STATE_CONFLICT' | 'WALLET_MISMATCH' | 'INVALID_REQUEST' | 'LENDING_SIMULATION_FAILED', readonly status: number, message: string, readonly retryable = false) { super(message); }
}

export class LendingService {
  private readonly store: LendingActionStore;
  constructor(private readonly options: {
    catalog: KaminoMarketCatalog; sdk: KaminoSdkAdapter; flags: LendingFlags; store?: LendingActionStore;
    now?: () => Date; send?: (signedTransaction: string) => Promise<string>;
    signatureState?: (signature: string) => Promise<'confirmed' | 'failed' | 'pending' | 'unknown'>;
  }) {
    this.store = options.store ?? new MemoryLendingActionStore();
  }

  async catalog() { return this.options.catalog.load(); }

  async history(identity: ExecutionIdentity, walletAddress: string) {
    const wallet = requireOwnedWallet(identity, walletAddress);
    return lendingActionHistoryResponseSchema.parse({
      walletAddress: wallet,
      items: this.store.list({ userId: identity.userId, walletAddress: wallet, limit: 50 }).map((action) => ({
        actionId: action.actionId, action: action.action, assetId: action.assetId, state: action.state,
        createdAt: action.createdAt, updatedAt: action.updatedAt,
      })),
    });
  }

  async wallet(identity: ExecutionIdentity, walletAddress: string): Promise<LendingWalletResponse> {
    const wallet = requireOwnedWallet(identity, walletAddress);
    try { return lendingWalletResponseSchema.parse(await this.options.sdk.readWallet(wallet)); }
    catch (error) { throw sdkFault(error); }
  }

  async preview(identity: ExecutionIdentity, input: LendingActionCreate): Promise<LendingRiskPreview> {
    const walletAddress = requireOwnedWallet(identity, input.walletAddress);
    const asset = resolveAsset(input.assetId);
    const catalog = await this.currentCatalogAsset(asset.assetId);
    const action = input.action;
    const gateReason = this.gateReason(action);
    const wallet = await this.wallet(identity, walletAddress);
    let amountRaw = input.amountRaw!;
    let secondaryAmountRaw = input.secondaryAmountRaw;
    if (action === 'supply-borrow' && (amountRaw === 'ALL' || secondaryAmountRaw === 'ALL')) throw new LendingServiceFault('INVALID_REQUEST', 400, 'Supply and borrow previews require exact raw amounts.');
    if (action === 'repay' || action === 'repay-withdraw') {
      if (amountRaw === 'ALL') amountRaw = wallet.obligations.flatMap((item) => item.debt).filter((leg) => leg.reserveAddress === catalog.debtReserveAddress).reduce((sum, leg) => sum + BigInt(leg.rawAmount), 0n).toString();
      if (BigInt(wallet.usdcBalance.spendableRawAmount) < BigInt(amountRaw)) throw new LendingServiceFault('INVALID_REQUEST', 422, 'The selected wallet does not have enough spendable USDC.');
    }
    if (action === 'supply' && amountRaw === 'ALL') throw new LendingServiceFault('INVALID_REQUEST', 400, 'Supply requires an exact raw token amount.');
    for (const value of [amountRaw, secondaryAmountRaw].filter((item): item is string => Boolean(item) && item !== 'ALL')) {
      const raw = BigInt(value);
      if (raw <= 0n || raw > U64_MAX) throw new LendingServiceFault('INVALID_REQUEST', 400, 'Enter a positive amount within the token program’s supported range.');
    }
    const collateralInput = action === 'supply' || action === 'supply-borrow' ? amountRaw : action === 'withdraw' ? amountRaw : undefined;
    if (collateralInput && collateralInput !== 'ALL' && (collateralInput === '0' || BigInt(collateralInput) <= 0n)) throw new LendingServiceFault('INVALID_REQUEST', 400, 'Enter an amount greater than zero.');
    if (action === 'supply' || action === 'supply-borrow') {
      const holding = wallet.holdings.find((item) => item.assetId === asset.assetId);
      if (!holding || holding.extensionState !== 'verified') throw new LendingServiceFault('INVALID_REQUEST', 422, 'The selected mint or Token-2022 extensions are not supported for supply.');
      if (BigInt(holding.spendableRawAmount) < BigInt(amountRaw)) throw new LendingServiceFault('INVALID_REQUEST', 422, 'The selected wallet does not have enough spendable xStock in its associated token account.');
    }
    const sdkAmount = action === 'supply-borrow' ? amountRaw : action === 'repay-withdraw' ? amountRaw : amountRaw;
    const sdkSecondary = action === 'supply-borrow' ? secondaryAmountRaw
      : action === 'repay-withdraw' ? secondaryAmountRaw : undefined;
    let risk: LendingRiskPreview;
    try {
      risk = lendingRiskPreviewSchema.parse(await this.options.sdk.preview({
        walletAddress, asset, action, amountRaw: sdkAmount,
        ...(sdkSecondary ? { secondaryAmountRaw: sdkSecondary } : {}), headroomBps: this.options.flags.borrowHeadroomBps,
      }));
    } catch (error) { throw sdkFault(error); }
    const routeAvailable = catalog.routeAvailable;
    const liquidityRaw = catalog.availableLiquidity === null ? null
      : new Decimal(catalog.availableLiquidity).mul(1_000_000).floor().toFixed(0);
    const maxBorrowRaw = liquidityRaw === null ? risk.maxBorrowRaw
      : Decimal.min(new Decimal(risk.maxBorrowRaw), new Decimal(liquidityRaw)).toFixed(0, Decimal.ROUND_DOWN);
    const requestedBorrowRaw = action === 'supply-borrow' ? secondaryAmountRaw : action === 'borrow' ? amountRaw : undefined;
    const liquidityBlock = requestedBorrowRaw && liquidityRaw !== null && new Decimal(requestedBorrowRaw).gt(liquidityRaw)
      ? 'The requested USDC amount exceeds current Kamino liquidity.' : null;
    const borrowLiquidityUnknown = requestedBorrowRaw !== undefined && liquidityRaw === null
      ? 'Current USDC liquidity is unavailable, so Warren cannot prepare a borrow.' : null;
    const repayAmountRaw = action === 'repay-withdraw' ? amountRaw : action === 'repay' ? amountRaw : undefined;
    const overRepay = repayAmountRaw && repayAmountRaw !== 'ALL' && new Decimal(repayAmountRaw).gt(risk.debtRawBefore)
      ? 'The repayment amount exceeds this wallet’s current USDC debt.' : null;
    const actionAvailable = routeAvailable && !gateReason && risk.actionAvailable && !liquidityBlock && !borrowLiquidityUnknown && !overRepay;
    const blockReason = gateReason ?? (!routeAvailable ? 'No pinned collateral-to-USDC route is active.'
      : liquidityBlock ?? borrowLiquidityUnknown ?? overRepay ?? risk.blockReason);
    return lendingRiskPreviewSchema.parse({
      ...risk, supplyApy: catalog.supplyApy, borrowApy: catalog.borrowApy, availableLiquidity: catalog.availableLiquidity,
      maxBorrowRaw,
      newRiskPaused: !this.options.flags.newRiskEnabled,
      actionAvailable, blockReason,
    });
  }

  async create(identity: ExecutionIdentity, input: LendingActionCreate, idempotencyKey: string): Promise<LendingReview> {
    validateIdempotency(idempotencyKey);
    const walletAddress = requireOwnedWallet(identity, input.walletAddress);
    const prior = this.store.getByIdempotency(identity.userId, idempotencyKey);
    if (prior) {
      if (prior.walletAddress !== walletAddress || prior.action !== input.action || prior.assetId !== input.assetId || prior.amountRaw !== input.amountRaw || prior.secondaryAmountRaw !== input.secondaryAmountRaw) {
        throw new LendingServiceFault('LENDING_STATE_CONFLICT', 409, 'This idempotency key is already linked to a different lending action.');
      }
      return reviewFromAction(prior);
    }
    const preview = await this.preview(identity, input);
    if (!preview.actionAvailable) throw new LendingServiceFault('LENDING_ACTION_PAUSED', 423, preview.blockReason ?? 'This lending action is paused.');
    const firstKind: LendingStepKind = input.action === 'supply-borrow' ? 'supply'
      : input.action === 'repay-withdraw' ? 'repay'
        : input.action;
    const firstAmount = input.amountRaw === 'ALL' ? firstKind === 'repay' ? preview.debtRawBefore : preview.maxWithdrawRaw : input.amountRaw!;
    const asset = resolveAsset(input.assetId);
    const step = await this.prepareStep(identity, walletAddress, asset, firstKind, firstAmount);
    const createdAt = this.now().toISOString();
    const action: LendingAction = {
      actionId: randomUUID(), userId: identity.userId, walletAddress, idempotencyKey,
      action: input.action, assetId: asset.assetId, state: 'review',
      amountRaw: input.amountRaw!, ...(input.secondaryAmountRaw ? { secondaryAmountRaw: input.secondaryAmountRaw } : {}),
      steps: [step], createdAt, updatedAt: createdAt,
    };
    try { this.store.save(action); }
    catch {
      const concurrent = this.store.getByIdempotency(identity.userId, idempotencyKey);
      if (concurrent && concurrent.walletAddress === walletAddress && concurrent.action === input.action
        && concurrent.assetId === input.assetId && concurrent.amountRaw === input.amountRaw
        && concurrent.secondaryAmountRaw === input.secondaryAmountRaw) return reviewFromAction(concurrent);
      if (concurrent) throw new LendingServiceFault('LENDING_STATE_CONFLICT', 409, 'This idempotency key is already linked to a different lending action.');
      throw new LendingServiceFault('LENDING_PROVIDER_UNAVAILABLE', 503, 'The lending review could not be saved safely.', true);
    }
    return reviewFromAction(action);
  }

  async nextStep(identity: ExecutionIdentity, actionId: string): Promise<LendingReview> {
    const action = this.requireAction(identity, actionId);
    const priorStep = action.steps.at(-1);
    if (!priorStep || priorStep.state !== 'confirmed') throw new LendingServiceFault('LENDING_STATE_CONFLICT', 409, 'The prior lending step must be confirmed before continuing.');
    if (action.action !== 'supply-borrow' && action.action !== 'repay-withdraw') throw new LendingServiceFault('LENDING_STATE_CONFLICT', 409, 'This action has no additional approval step.');
    if (action.steps.length !== 1) return reviewFromAction(action);
    const kind: LendingStepKind = action.action === 'supply-borrow' ? 'borrow' : 'withdraw';
    const amount = action.secondaryAmountRaw === 'ALL' ? 'ALL' : action.secondaryAmountRaw!;
    const input = { action: kind, walletAddress: action.walletAddress, assetId: action.assetId, amountRaw: amount } as LendingActionCreate;
    const preview = await this.preview(identity, input);
    if (!preview.actionAvailable) throw new LendingServiceFault('LENDING_ACTION_PAUSED', 423, preview.blockReason ?? 'The next lending step is paused.');
    const resolvedRaw = amount === 'ALL' ? kind === 'withdraw' ? preview.maxWithdrawRaw : preview.maxBorrowRaw : amount;
    if (resolvedRaw === '0') throw new LendingServiceFault('INVALID_REQUEST', 422, 'The current safe action amount is zero.');
    const step = await this.prepareStep(identity, action.walletAddress, resolveAsset(action.assetId), kind, resolvedRaw);
    step.sequence = action.steps.length + 1;
    action.steps.push(step);
    action.state = 'review'; action.updatedAt = this.now().toISOString();
    this.store.update(action);
    return reviewFromAction(action);
  }

  async refreshStep(identity: ExecutionIdentity, actionId: string, stepId: string): Promise<LendingReview> {
    const action = this.requireAction(identity, actionId);
    const step = action.steps.find((item) => item.stepId === stepId);
    if (!step || step.state !== 'expired' && !(step.state === 'review' && Date.parse(step.expiresAt) <= this.now().getTime())) {
      throw new LendingServiceFault('LENDING_STATE_CONFLICT', 409, 'Only an expired, unsigned step can be refreshed.');
    }
    if (step.signature || step.submissionStartedAt) throw new LendingServiceFault('LENDING_STATE_CONFLICT', 409, 'A submitted step cannot be refreshed while its signature is being reconciled.');
    const fresh = await this.prepareStep(identity, action.walletAddress, resolveAsset(action.assetId), step.kind, step.amountRaw);
    Object.assign(step, fresh, { stepId, sequence: step.sequence });
    step.state = 'review'; step.updatedAt = this.now().toISOString();
    action.state = 'review'; action.updatedAt = step.updatedAt;
    this.store.update(action);
    return reviewFromAction(action);
  }

  async submit(identity: ExecutionIdentity, actionId: string, stepId: string, signedTransaction: string, idempotencyKey: string): Promise<LendingStepResult> {
    validateIdempotency(idempotencyKey);
    const action = this.requireAction(identity, actionId);
    const step = action.steps.find((item) => item.stepId === stepId);
    if (!step) throw new LendingServiceFault('LENDING_NOT_FOUND', 404, 'The lending review step was not found.');
    if (step.idempotencyKey && step.idempotencyKey !== idempotencyKey) throw new LendingServiceFault('LENDING_STATE_CONFLICT', 409, 'This signed step is already bound to a different idempotency key.');
    if (step.signature || step.submissionStartedAt || step.state === 'unknown' || step.state === 'submitted') return this.reconcile(action, step);
    if (step.state !== 'review') throw new LendingServiceFault('LENDING_STATE_CONFLICT', 409, 'This lending step is no longer ready for submission.');
    let blockhashExpired = false;
    try { blockhashExpired = await this.options.sdk.isBlockhashExpired(step.lastValidBlockHeight); }
    catch { throw new LendingServiceFault('LENDING_PROVIDER_UNAVAILABLE', 503, 'Solana block height could not be refreshed before signing.', true); }
    if (blockhashExpired || Date.parse(step.expiresAt) <= this.now().getTime()) {
      step.state = 'expired'; action.state = 'refresh_required'; action.updatedAt = this.now().toISOString(); this.store.update(action);
      throw new LendingServiceFault('LENDING_STATE_CONFLICT', 409, 'This review expired. Refresh it to rebuild and simulate a new transaction.');
    }
    const signature = verifySignedTransaction(step.unsignedTransaction, signedTransaction, action.walletAddress);
    step.signature = signature; step.idempotencyKey = idempotencyKey; step.submissionStartedAt = this.now().toISOString();
    step.state = 'unknown'; step.updatedAt = step.submissionStartedAt; action.state = 'unknown'; action.updatedAt = step.updatedAt;
    this.store.update(action);
    try {
      const sentSignature = await (this.options.send ?? (async () => { throw new Error('Lending transaction submission is not configured.'); }))(signedTransaction);
      if (sentSignature !== signature) throw new Error('RPC returned a signature that does not match the signed transaction.');
      step.state = 'submitted'; step.message = 'Transaction submitted to Solana; confirmation is pending.';
      action.state = 'in_progress'; step.updatedAt = this.now().toISOString(); action.updatedAt = step.updatedAt; this.store.update(action);
    } catch {
      step.state = 'unknown'; step.message = 'Submission may have reached Solana. Warren is checking this signature; do not resubmit.';
      step.updatedAt = this.now().toISOString(); action.state = 'unknown'; action.updatedAt = step.updatedAt; this.store.update(action);
    }
    return this.reconcile(action, step);
  }

  async status(identity: ExecutionIdentity, actionId: string): Promise<LendingReview> {
    const action = this.requireAction(identity, actionId);
    const step = action.steps.at(-1);
    if (step && ['submitted', 'unknown'].includes(step.state) && step.signature) await this.reconcile(action, step);
    else if (step?.state === 'review') {
      let expired = Date.parse(step.expiresAt) <= this.now().getTime();
      if (!expired) {
        try { expired = await this.options.sdk.isBlockhashExpired(step.lastValidBlockHeight); }
        catch { /* A transient height error does not invalidate the existing unsigned review. */ }
      }
      if (expired) {
        step.state = 'expired'; action.state = 'refresh_required';
        step.updatedAt = this.now().toISOString(); action.updatedAt = step.updatedAt; this.store.update(action);
      }
    }
    return reviewFromAction(this.requireAction(identity, actionId));
  }

  private async reconcile(action: LendingAction, step: LendingStep): Promise<LendingStepResult> {
    if (!step.signature) return resultFromStep(action, step, 'Submission is still being reconciled.');
    let state: 'confirmed' | 'failed' | 'pending' | 'unknown';
    try { state = await (this.options.signatureState ?? (async () => 'unknown'))(step.signature); }
    catch { state = 'unknown'; }
    if (state === 'confirmed') {
      step.state = 'confirmed'; step.message = 'Transaction confirmed on Solana.';
      const composite = action.action === 'supply-borrow' || action.action === 'repay-withdraw';
      action.state = composite && action.steps.length === 1 ? 'in_progress' : 'confirmed';
    } else if (state === 'failed') {
      step.state = 'failed'; step.message = 'Solana confirmed that this transaction failed.'; action.state = 'failed';
    } else {
      step.state = state === 'pending' ? 'submitted' : 'unknown';
      step.message = 'Transaction status is unresolved. Do not retry or duplicate it.';
      action.state = 'unknown';
    }
    step.updatedAt = this.now().toISOString(); action.updatedAt = step.updatedAt; this.store.update(action);
    return resultFromStep(action, step, step.message ?? 'Transaction status updated.');
  }

  private async prepareStep(identity: ExecutionIdentity, walletAddress: string, asset: AssetIdentity, kind: LendingStepKind, amountRaw: string, displayAmountOverride?: string): Promise<LendingStep> {
    const enabled = this.actionEnabled(kind);
    if (!enabled) throw new LendingServiceFault('LENDING_ACTION_PAUSED', 423, this.gateReason(kind) ?? 'This lending action is paused.');
    const current = await this.preview(identity, { action: kind, walletAddress, assetId: asset.assetId, amountRaw } as LendingActionCreate);
    if (!current.actionAvailable) throw new LendingServiceFault('LENDING_ACTION_PAUSED', 423, current.blockReason ?? 'This lending action is paused.');
    try {
      const prepared = await this.options.sdk.prepare({ walletAddress, asset, kind, amountRaw });
      const now = this.now().toISOString();
      return {
        stepId: randomUUID(), sequence: 1, kind, state: 'review',
        unsignedTransaction: prepared.unsignedTransaction, expiresAt: prepared.expiresAt,
        lastValidBlockHeight: prepared.lastValidBlockHeight, amountRaw: prepared.amountRaw,
        amount: displayAmountOverride ? displayAmountOverride : prepared.amount,
        displayAmount: displayAmountOverride ? displayAmountOverride : prepared.displayAmount,
        symbol: kind === 'borrow' || kind === 'repay' ? 'USDC' : asset.symbol,
        decimals: prepared.decimals, feeEstimateLamports: prepared.feeEstimateLamports,
        rentEstimateLamports: prepared.rentEstimateLamports,
        simulation: prepared.simulation, updatedAt: now,
      };
    } catch (error) { throw sdkFault(error); }
  }

  private async currentCatalogAsset(assetId: string) {
    let catalog;
    try { catalog = lendingCatalogResponseSchema.parse(await this.options.catalog.load()); }
    catch (error) { throw sdkFault(error); }
    const asset = catalog.assets.find((item) => item.assetId === assetId);
    if (!asset) throw new LendingServiceFault('LENDING_NOT_FOUND', 404, 'The xStock is not listed in the pinned Kamino market.');
    return asset;
  }

  private gateReason(action: LendingActionKind | LendingStepKind): string | null {
    if (action === 'supply' || action === 'borrow' || action === 'supply-borrow') return this.options.flags.newRiskEnabled ? null : 'New supply and borrowing are paused by Warren’s risk control.';
    if (action === 'repay' || action === 'repay-withdraw') return this.options.flags.repayEnabled ? null : 'Repayment is paused by Warren’s recovery control.';
    if (action === 'withdraw') return this.options.flags.withdrawEnabled ? null : 'Withdrawal is paused by Warren’s recovery control.';
    return action === 'supply' || action === 'borrow' ? this.options.flags.newRiskEnabled ? null : 'New supply and borrowing are paused by Warren’s risk control.'
      : action === 'repay' ? this.options.flags.repayEnabled ? null : 'Repayment is paused by Warren’s recovery control.'
        : this.options.flags.withdrawEnabled ? null : 'Withdrawal is paused by Warren’s recovery control.';
  }
  private actionEnabled(kind: LendingStepKind) { return this.gateReason(kind) === null; }
  private requireAction(identity: ExecutionIdentity, actionId: string) {
    const action = this.store.get(actionId);
    if (!action || action.userId !== identity.userId || !identity.walletAddresses.some((wallet) => canonical(wallet) === action.walletAddress)) {
      throw new LendingServiceFault('LENDING_NOT_FOUND', 404, 'The lending action was not found.');
    }
    return action;
  }
  private now() { return this.options.now?.() ?? new Date(); }
}

function reviewFromAction(action: LendingAction) {
  return lendingReviewSchema.parse({
    actionId: action.actionId, state: action.state, action: action.action, walletAddress: action.walletAddress, assetId: action.assetId,
    steps: action.steps.map(({ stepId, sequence, kind, state, unsignedTransaction, expiresAt, lastValidBlockHeight, amountRaw, amount, displayAmount, symbol, feeEstimateLamports, rentEstimateLamports, simulation }) => ({
      stepId, sequence, kind, state, unsignedTransaction, expiresAt, lastValidBlockHeight, amountRaw, amount, displayAmount, symbol, feeEstimateLamports, rentEstimateLamports, simulation,
    })), createdAt: action.createdAt, updatedAt: action.updatedAt,
  });
}
function resultFromStep(action: LendingAction, step: LendingStep, message: string): LendingStepResult {
  return lendingStepResultSchema.parse({ actionId: action.actionId, stepId: step.stepId, state: step.state, signature: step.signature ?? null,
    explorerUrl: step.signature ? `https://explorer.solana.com/tx/${step.signature}` : null, message, updatedAt: step.updatedAt });
}
function requireOwnedWallet(identity: ExecutionIdentity, input: string) {
  const wallet = canonical(input);
  if (!identity.walletAddresses.some((candidate) => canonical(candidate) === wallet)) throw new LendingServiceFault('WALLET_MISMATCH', 403, 'This wallet does not belong to the signed-in Privy account.');
  return wallet;
}
function canonical(input: string) {
  try { return new PublicKey(input).toBase58(); }
  catch { throw new LendingServiceFault('INVALID_REQUEST', 400, 'The selected Solana wallet address is invalid.'); }
}
function resolveAsset(assetId: string) {
  const asset = KAMINO_XSTOCK_ASSETS.find((candidate) => candidate.assetId === assetId);
  if (!asset) throw new LendingServiceFault('LENDING_NOT_FOUND', 404, 'The xStock is not in Warren’s pinned lending allowlist.');
  return asset;
}
function validateIdempotency(value: string) {
  if (!idempotencyPattern.test(value)) throw new LendingServiceFault('INVALID_REQUEST', 400, 'A valid idempotency key is required.');
}
function sdkFault(error: unknown): LendingServiceFault {
  if (error instanceof LendingServiceFault) return error;
  if (error instanceof KaminoSdkFault) return new LendingServiceFault(error.status === 503 ? 'LENDING_PROVIDER_UNAVAILABLE' : 'LENDING_SIMULATION_FAILED', error.status, error.message, error.retryable);
  return new LendingServiceFault('LENDING_PROVIDER_UNAVAILABLE', 503, 'Kamino or Solana account data could not be refreshed.', true);
}
function verifySignedTransaction(unsignedTransaction: string, signedTransaction: string, walletAddress: string) {
  try {
    const unsigned = VersionedTransaction.deserialize(Buffer.from(unsignedTransaction, 'base64'));
    const signed = VersionedTransaction.deserialize(Buffer.from(signedTransaction, 'base64'));
    const unsignedMessage = Buffer.from(unsigned.message.serialize());
    const signedMessage = Buffer.from(signed.message.serialize());
    if (!unsignedMessage.equals(signedMessage)) throw new Error();
    if (signed.message.header.numRequiredSignatures !== 1) throw new Error();
    const signerIndex = signed.message.staticAccountKeys.slice(0, signed.message.header.numRequiredSignatures).findIndex((key) => key.toBase58() === walletAddress);
    if (signerIndex < 0) throw new Error();
    const signature = signed.signatures[signerIndex];
    if (!signature || signature.every((value) => value === 0) || !nacl.sign.detached.verify(signedMessage, signature, new PublicKey(walletAddress).toBytes())) throw new Error();
    return bs58.encode(signature);
  } catch { throw new LendingServiceFault('INVALID_REQUEST', 400, 'The signed transaction does not match this Kamino review.'); }
}
