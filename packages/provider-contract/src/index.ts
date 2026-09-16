import type { WalletFamily } from '@warren/auth-contract';

export type GrantedCredential = { credentialRef: string; family: WalletFamily; address: string; network: string };
export type ExactMessageRequest = { requestId: string; credentialRef: string; family: WalletFamily; network: string; messageUtf8: Uint8Array; messageSha256: string };
export type ProviderRequest = { id: string; state: 'awaiting_signature'; pollAfterMs: number };
export type ProviderRequestResult = { state: 'awaiting_signature' | 'approved' | 'rejected' | 'expired'; signature?: string };
export type CredentialValidation = { credentialRef: string; family: WalletFamily; address: string; network: string };
/** Provider OAuth/grant credentials remain server-owned; no provider token is a Warren session. */
export interface ProviderAdapter {
  readonly id: string;
  getSupport(): Promise<{ families: WalletFamily[] }>;
  listCredentials(input: { family: WalletFamily }): Promise<GrantedCredential[]>;
  /** Returns provider-recorded credential metadata. `network` is authoritative, never client supplied. */
  validateCredential(input: { credentialRef: string; family: WalletFamily; address: string }): Promise<CredentialValidation | null>;
  requestMessageSignature(input: ExactMessageRequest): Promise<ProviderRequest>;
  getMessageSignature(input: { requestId: string }): Promise<ProviderRequestResult>;
}
