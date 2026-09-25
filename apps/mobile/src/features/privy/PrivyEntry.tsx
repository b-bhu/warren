import { useState } from 'react';

import { LiquidLedgerScreen } from './LiquidLedgerScreen';
import { usePrivyRuntimeStatus } from './config';

type PrivyEntryProps = {
  contextLabel?: string;
  continueLabel?: string;
  onContinue?: () => void;
  onCancel?: () => void;
  presentation?: 'screen' | 'sheet';
};

/** Browser preview: Privy's Expo SDK intentionally does not run on web. */
export function PrivyEntry({ contextLabel, continueLabel, onContinue, onCancel, presentation = 'screen' }: PrivyEntryProps) {
  const runtimeStatus = usePrivyRuntimeStatus();
  const [message, setMessage] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const nativeOnly = () => setMessage('Open Warren on iOS or Android to sign in.');

  if (runtimeStatus === 'missing-config') {
    return (
      <LiquidLedgerScreen
        contextLabel={contextLabel}
        mode="missing-config"
        onCancel={onCancel}
        presentation={presentation}
      />
    );
  }

  return (
    <LiquidLedgerScreen
      contextLabel={contextLabel}
      emailAuth={{
        email,
        code,
        codeSent: false,
        onEmailChange: (value) => { setEmail(value); setMessage(null); },
        onCodeChange: setCode,
        onSendCode: nativeOnly,
        onVerifyCode: nativeOnly,
      }}
      continueLabel={continueLabel}
      onContinue={onContinue}
      message={message}
      mode="web-preview"
      onCancel={onCancel}
      presentation={presentation}
      onLogin={nativeOnly}
    />
  );
}
