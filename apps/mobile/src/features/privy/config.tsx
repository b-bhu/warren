import { createContext, useContext, type PropsWithChildren } from 'react';

export type PrivyRuntimeStatus = 'configured' | 'missing-config' | 'unsupported-platform';

type PrivyRuntimeContextValue = {
  status: PrivyRuntimeStatus;
};

const PrivyRuntimeContext = createContext<PrivyRuntimeContextValue>({
  status: 'unsupported-platform',
});

export function PrivyRuntimeBoundary({
  children,
  status,
}: PropsWithChildren<PrivyRuntimeContextValue>) {
  return (
    <PrivyRuntimeContext.Provider value={{ status }}>
      {children}
    </PrivyRuntimeContext.Provider>
  );
}

export function usePrivyRuntimeStatus() {
  return useContext(PrivyRuntimeContext).status;
}

export function readPublicPrivyConfig() {
  const appId = process.env.EXPO_PUBLIC_PRIVY_APP_ID?.trim();
  const clientId = process.env.EXPO_PUBLIC_PRIVY_CLIENT_ID?.trim();

  if (!appId || !clientId) return null;
  return { appId, clientId };
}
