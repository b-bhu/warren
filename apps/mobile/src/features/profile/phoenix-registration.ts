import type { PhoenixRegistrationResult } from '@warren/portfolio-contract';

export async function waitForPhoenixRegistration(input: {
  attempts?: number;
  pause?: (milliseconds: number) => Promise<void>;
  read: () => Promise<PhoenixRegistrationResult>;
}): Promise<PhoenixRegistrationResult> {
  const attempts = input.attempts ?? 5;
  const pause = input.pause ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  let latest: PhoenixRegistrationResult | undefined;
  for (let index = 0; index < attempts; index += 1) {
    if (index > 0) await pause(1_200);
    latest = await input.read();
    if (latest.state !== 'submitted') return latest;
  }
  return latest!;
}

export function phoenixRegistrationErrorMessage(error: unknown) {
  if (isWalletRejection(error)) return 'You cancelled the wallet approval. Nothing was submitted.';
  if (isInsufficientSol(error)) {
    return 'This wallet does not have enough SOL to create the Phoenix account. Deposit more SOL to cover account rent and the network fee, then try again.';
  }
  return error instanceof Error && error.message
    ? error.message
    : 'Phoenix account creation could not be completed. Try again.';
}

function isWalletRejection(error: unknown) {
  if (!(error instanceof Error)) return false;
  return /reject|cancel|declin|user denied|4001/i.test(error.message);
}

function isInsufficientSol(error: unknown) {
  if (!(error instanceof Error)) return false;
  return /insufficient (?:funds|lamports|balance)|account rent|rent(?:-| )exempt|attempt to debit an account but found no record of a prior credit/i.test(error.message);
}
