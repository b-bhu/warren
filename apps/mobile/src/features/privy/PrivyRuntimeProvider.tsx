import type { PropsWithChildren } from 'react';

import { PrivyRuntimeBoundary } from './config';

/** Privy's Expo SDK is native-only; web keeps the approved visual preview available. */
export function PrivyRuntimeProvider({ children }: PropsWithChildren) {
  return (
    <PrivyRuntimeBoundary status="unsupported-platform">
      {children}
    </PrivyRuntimeBoundary>
  );
}
