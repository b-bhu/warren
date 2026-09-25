import { PrivyProvider as BasePrivyProvider } from '@privy-io/expo';
import Constants from 'expo-constants';
import type { PropsWithChildren } from 'react';

import { PrivyRuntimeBoundary, readPublicPrivyConfig } from './config';

const publicConfig = readPublicPrivyConfig();

export function PrivyRuntimeProvider({ children }: PropsWithChildren) {
  // Privy and wallet-native actions require Warren's development/standalone binary.
  // Keep guest discovery available in Expo Go without mounting that native runtime.
  if (Constants.appOwnership === 'expo') {
    return (
      <PrivyRuntimeBoundary status="unsupported-platform">
        {children}
      </PrivyRuntimeBoundary>
    );
  }

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
            // Warren is Solana-only. Privy keeps this idempotent for returning users.
            solana: { createOnLogin: 'all-users' },
          },
        }}>
        {children}
      </BasePrivyProvider>
    </PrivyRuntimeBoundary>
  );
}
