import { PrivyProvider as BasePrivyProvider } from '@privy-io/expo';
import type { PropsWithChildren } from 'react';

import { PrivyRuntimeBoundary, readPublicPrivyConfig } from './config';

const publicConfig = readPublicPrivyConfig();

export function PrivyRuntimeProvider({ children }: PropsWithChildren) {
  if (!publicConfig) {
    return (
      <PrivyRuntimeBoundary status="missing-config">
        {children}
      </PrivyRuntimeBoundary>
    );
  }

  return (
    <PrivyRuntimeBoundary status="configured">
      <BasePrivyProvider
        appId={publicConfig.appId}
        clientId={publicConfig.clientId}
        config={{
          embedded: {
            // A first social sign-in provisions both default trading wallets.
            // Privy keeps this idempotent for returning users.
            solana: { createOnLogin: 'all-users' },
            ethereum: { createOnLogin: 'all-users' },
          },
        }}>
        {children}
      </BasePrivyProvider>
    </PrivyRuntimeBoundary>
  );
}
