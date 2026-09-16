import { createHash } from 'node:crypto';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { privateKeyToAccount } from 'viem/accounts';
import type { ExactMessageRequest, ProviderAdapter, ProviderRequest, ProviderRequestResult } from '@warren/provider-contract';

// This reproducible non-production key is derived from a public test label; it is never a user or production secret.
const EVM_KEY = `0x${createHash('sha256').update('warren-deterministic-wallet-provider-v1').digest('hex')}` as `0x${string}`;
const EVM_ALT_KEY = `0x${createHash('sha256').update('warren-deterministic-wallet-provider-alt-v1').digest('hex')}` as `0x${string}`;
const SOLANA_SEED = new Uint8Array(32).fill(7);

type Stored = { input: ExactMessageRequest; result?: ProviderRequestResult };

/** Fixed local keys only. Constructor rejects production to make accidental enablement fail closed. */
export class DeterministicTestWalletAdapter implements ProviderAdapter {
  readonly id = 'deterministic';
  readonly evmAddress = privateKeyToAccount(EVM_KEY).address;
  readonly alternateEvmAddress = privateKeyToAccount(EVM_ALT_KEY).address;
  readonly solanaKeypair = nacl.sign.keyPair.fromSeed(SOLANA_SEED);
  readonly solanaAddress = bs58.encode(this.solanaKeypair.publicKey);
  private readonly requests = new Map<string, Stored>();
  private signatureRequests = 0;

  constructor(environment = process.env.NODE_ENV ?? 'development') {
    if (environment !== 'development' && environment !== 'test') throw new Error('Deterministic provider is disabled outside development/test');
  }
  async getSupport() { return { families: ['evm', 'solana'] as Array<'evm' | 'solana'> }; }
  async listCredentials(input: { family: 'evm' | 'solana' }) {
    return input.family === 'evm'
      ? [{ credentialRef: 'deterministic:evm', family: 'evm' as const, address: this.evmAddress, network: '1' }, { credentialRef: 'deterministic:evm-alt', family: 'evm' as const, address: this.alternateEvmAddress, network: '1' }]
      : [{ credentialRef: 'deterministic:solana', family: 'solana' as const, address: this.solanaAddress, network: 'devnet' }];
  }
  async validateCredential(input: { credentialRef: string; family: 'evm' | 'solana'; address: string }) {
    const expectedRef = input.family === 'evm' && input.credentialRef === 'deterministic:evm-alt' ? 'deterministic:evm-alt' : `deterministic:${input.family}`;
    const expectedAddress = input.family === 'evm' ? (expectedRef === 'deterministic:evm-alt' ? this.alternateEvmAddress : this.evmAddress) : this.solanaAddress;
    if (input.credentialRef !== expectedRef || input.address !== expectedAddress) return null;
    return { credentialRef: expectedRef, family: input.family, address: expectedAddress, network: input.family === 'evm' ? '1' : 'devnet' };
  }
  async requestMessageSignature(input: ExactMessageRequest): Promise<ProviderRequest> {
    this.signatureRequests += 1; this.requests.set(input.requestId, { input }); return { id: input.requestId, state: 'awaiting_signature', pollAfterMs: 250 };
  }
  async getMessageSignature({ requestId }: { requestId: string }): Promise<ProviderRequestResult> {
    const item = this.requests.get(requestId); if (!item) return { state: 'expired' };
    if (!item.result) {
      const text = new TextDecoder().decode(item.input.messageUtf8);
      const signature = item.input.family === 'evm'
        ? await privateKeyToAccount(item.input.credentialRef === 'deterministic:evm-alt' ? EVM_ALT_KEY : EVM_KEY).signMessage({ message: text })
        : Buffer.from(nacl.sign.detached(item.input.messageUtf8, this.solanaKeypair.secretKey)).toString('hex');
      item.result = { state: 'approved', signature };
    }
    return item.result;
  }
  async signForTests(family: 'evm' | 'solana', message: string, credentialRef = `deterministic:${family}`): Promise<string> {
    if (family === 'evm') return privateKeyToAccount(credentialRef === 'deterministic:evm-alt' ? EVM_ALT_KEY : EVM_KEY).signMessage({ message });
    return Buffer.from(nacl.sign.detached(new TextEncoder().encode(message), this.solanaKeypair.secretKey)).toString('hex');
  }
  fingerprint(): string { return createHash('sha256').update(this.evmAddress).digest('hex').slice(0, 12); }
  get signatureRequestCount() { return this.signatureRequests; }
}
