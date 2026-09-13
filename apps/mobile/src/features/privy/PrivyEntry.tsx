import { useState } from 'react';

import { LiquidLedgerScreen } from './LiquidLedgerScreen';
import { usePrivyRuntimeStatus } from './config';

/** Browser preview: Privy's Expo SDK intentionally does not run on web. */
export function PrivyEntry() {
  const runtimeStatus = usePrivyRuntimeStatus();
  const [message, setMessage] = useState<string | null>(null);

  if (runtimeStatus === 'missing-config') {
    return <LiquidLedgerScreen mode="missing-config" />;
  }

  return (
    <LiquidLedgerScreen
      message={message}
      mode="web-preview"
      onLogin={() => {
        setMessage('Open this project in an iOS or Android development build to sign in with Privy.');
      }}
    />
  );
}
