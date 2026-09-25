import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import { useRouter, type Href } from 'expo-router';

import { PrivyAuthSheet } from './PrivyAuthSheet';

type OpenAuthSheetOptions = {
  contextLabel?: string;
  continueLabel?: string;
  onAuthenticated?: () => void;
};

type AuthSheetController = {
  open: (options?: OpenAuthSheetOptions) => void;
};

const AuthSheetContext = createContext<AuthSheetController | undefined>(undefined);

export function PrivyAuthSheetProvider({ children }: PropsWithChildren) {
  const router = useRouter();
  const [request, setRequest] = useState<{ contextLabel?: string; continueLabel: string; id: number }>();
  const requestId = useRef(0);
  const completion = useRef<(() => void) | undefined>(undefined);

  const close = useCallback(() => {
    completion.current = undefined;
    setRequest(undefined);
  }, []);

  const open = useCallback((options: OpenAuthSheetOptions = {}) => {
    completion.current = options.onAuthenticated;
    requestId.current += 1;
    setRequest({ contextLabel: options.contextLabel, continueLabel: options.continueLabel ?? (options.onAuthenticated ? 'Continue' : 'Explore markets'), id: requestId.current });
  }, []);

  const authenticated = useCallback(() => {
    const onAuthenticated = completion.current;
    completion.current = undefined;
    setRequest(undefined);
    if (onAuthenticated) onAuthenticated();
    else router.push('/(tabs)/markets' as Href);
  }, [router]);

  const value = useMemo<AuthSheetController>(() => ({ open }), [open]);

  return (
    <AuthSheetContext.Provider value={value}>
      {children}
      <PrivyAuthSheet
        key={request?.id ?? 'closed'}
        contextLabel={request?.contextLabel}
        continueLabel={request?.continueLabel}
        onAuthenticated={authenticated}
        onClose={close}
        visible={Boolean(request)}
      />
    </AuthSheetContext.Provider>
  );
}

export function usePrivyAuthSheet() {
  const value = useContext(AuthSheetContext);
  if (!value) throw new Error('usePrivyAuthSheet must be used within PrivyAuthSheetProvider.');
  return value;
}
