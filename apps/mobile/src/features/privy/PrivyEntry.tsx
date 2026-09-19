import { useState } from 'react';

import { LiquidLedgerScreen } from './LiquidLedgerScreen';
import { usePrivyRuntimeStatus } from './config';

type PrivyEntryProps = {
  contextLabel?: string;
  onCancel?: () => void;
};

/** Browser preview: Privy's Expo SDK intentionally does not run on web. */
export function PrivyEntry({ contextLabel, onCancel }: PrivyEntryProps) {
  const runtimeStatus = usePrivyRuntimeStatus();
  const [message, setMessage] = useState<string | null>(null);

  if (runtimeStatus === 'missing-config') {
    return (
      <LiquidLedgerScreen
        contextLabel={contextLabel}
        mode="missing-config"
        onCancel={onCancel}
      />
    );
  }

  return (
    <LiquidLedgerScreen
      contextLabel={contextLabel}
      message={message}
      mode="web-preview"
      onCancel={onCancel}
      onLogin={() => {
        setMessage('Open this project in an iOS or Android development build to sign in with Privy.');
      }}
    />
  );
}
