import { z } from 'zod';

export const walletFamilySchema = z.enum(['evm', 'solana']);
export type WalletFamily = z.infer<typeof walletFamilySchema>;
export const attemptPurposeSchema = z.enum(['sign_in', 'link_wallet']);
export type AttemptPurpose = z.infer<typeof attemptPurposeSchema>;
export const protocolSchema = z.enum(['eip4361-v1', 'siws-v1']);
export type Protocol = z.infer<typeof protocolSchema>;

export const errorCodeSchema = z.enum([
  'INVALID_REQUEST', 'SESSION_INVALID', 'ATTEMPT_FORBIDDEN', 'ATTEMPT_STATE_INVALID',
  'ATTEMPT_EXPIRED', 'CHALLENGE_EXPIRED', 'CHALLENGE_REPLAYED', 'PROOF_INVALID',
  'ADDRESS_MISMATCH', 'WRONG_NETWORK', 'WALLET_CONFLICT',
  'EVM_CONTRACT_ACCOUNT_UNSUPPORTED', 'PROVIDER_DISABLED', 'PROVIDER_UNAVAILABLE', 'RATE_LIMITED', 'NOT_FOUND', 'INTERNAL_ERROR'
]);
export type ErrorCode = z.infer<typeof errorCodeSchema>;
export const apiErrorSchema = z.object({ error: z.object({
  code: errorCodeSchema, message: z.string(), retryable: z.boolean(), requestId: z.string(),
  attemptId: z.string().optional(), details: z.object({ retryAfterSeconds: z.number().optional(), supportedContexts: z.array(z.string()).optional() }).optional(),
}) });

export const createAttemptSchema = z.object({
  purpose: attemptPurposeSchema, family: walletFamilySchema, providerId: z.string().min(1).max(64).regex(/^[a-z][a-z0-9_-]*$/),
}).strict();
export const challengeRequestSchema = z.object({
  credentialRef: z.string().min(1).max(256).regex(/^[A-Za-z0-9._:-]+$/),
  address: z.string().min(1).max(128),
  chainContext: z.string().min(1).max(80),
}).strict();
export const proofSchema = z.object({
  challengeId: z.string().uuid(), protocol: protocolSchema,
  signature: z.string().min(1).max(512).regex(/^(0x)?[0-9a-f]+$/i),
}).strict();
export const refreshSchema = z.object({ refreshToken: z.string().min(20), }).strict();
export const signatureRequestSchema = z.object({
  challengeId: z.string().uuid(), credentialRef: z.string().min(1).max(256).regex(/^[A-Za-z0-9._:-]+$/),
}).strict();
export const idempotencyKeySchema = z.string().min(16).max(128).regex(/^[A-Za-z0-9._:-]+$/);
export const credentialSchema = z.object({ credentialRef: z.string(), family: walletFamilySchema, address: z.string(), network: z.string() });
export const challengeResponseSchema = z.object({ challengeId: z.string().uuid(), protocol: protocolSchema, message: z.string(), messageUtf8Hex: z.string(), sha256: z.string().length(64), nonce: z.string().regex(/^[A-Za-z0-9]{8,}$/), issuedAt: z.string().datetime(), expiresAt: z.string().datetime(), credentialRef: z.string() });
export const sessionTokensSchema = z.object({ accessToken: z.string(), refreshToken: z.string(), accessExpiresAt: z.string().datetime() });
export const signatureRequestResponseSchema = z.object({ requestId: z.string().uuid(), state: z.string(), pollAfterMs: z.number().int().positive().optional() });

export type ChallengeInput = {
  domain: string; uri: string; address: string; nonce: string; issuedAt: string; expiresAt: string;
  requestId: string; chainContext: string; statement: string;
};
export const challengeInputSchema = z.object({
  domain: z.string().min(1), uri: z.string().url(), address: z.string().min(1), nonce: z.string().regex(/^[A-Za-z0-9]{8,}$/),
  issuedAt: z.string().datetime(), expiresAt: z.string().datetime(), requestId: z.string().uuid(), chainContext: z.string().min(1), statement: z.string().min(1),
}).strict();

/** The sole v1 ERC-4361 serializer. Signing clients must use these exact bytes. */
export function serializeEip4361V1(input: ChallengeInput): string {
  challengeInputSchema.parse(input);
  const chainId = Number(input.chainContext);
  return `${input.domain} wants you to sign in with your Ethereum account:\n${input.address}\n\n${input.statement}\n\nURI: ${input.uri}\nVersion: 1\nChain ID: ${chainId}\nNonce: ${input.nonce}\nIssued At: ${input.issuedAt}\nExpiration Time: ${input.expiresAt}\nRequest ID: ${input.requestId}`;
}

/** Printable-ASCII, LF-only SIWS compatible plaintext serializer. */
export function serializeSiwsV1(input: ChallengeInput): string {
  challengeInputSchema.parse(input);
  const fields = [input.domain, input.uri, input.address, input.nonce, input.issuedAt, input.expiresAt, input.requestId, input.chainContext, input.statement];
  if (fields.some((value) => !/^[\x20-\x7e]+$/.test(value))) throw new Error('SIWS v1 fields must be printable ASCII');
  return `${input.domain} wants you to sign in with your Solana account:\n${input.address}\n\n${input.statement}\n\nURI: ${input.uri}\nVersion: 1\nChain ID: ${input.chainContext}\nNonce: ${input.nonce}\nIssued At: ${input.issuedAt}\nExpiration Time: ${input.expiresAt}\nRequest ID: ${input.requestId}`;
}

export function messageUtf8Hex(message: string): string {
  return Array.from(new TextEncoder().encode(message), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
