import { StatusBar } from 'expo-status-bar';
import * as Clipboard from 'expo-clipboard';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path, Rect } from 'react-native-svg';

import { BrandLogo } from '@/components/brand-logo';
import { WalletCard } from '@/components/WalletCard';
import { Colors, Fonts } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type LiquidLedgerMode =
  | 'sign-in'
  | 'wallet-approval'
  | 'preparing'
  | 'ready'
  | 'error'
  | 'recovery-required'
  | 'missing-config'
  | 'unsupported-platform'
  | 'web-preview';

type Provider = 'email' | 'external-wallet';

type EmailAuth = {
  code: string;
  codeSent: boolean;
  email: string;
  message?: string | null;
  resendAvailableAt?: number;
  onCodeChange?: (code: string) => void;
  onEmailChange?: (email: string) => void;
  onResendCode?: () => void;
  onReset?: () => void;
  onSendCode?: () => void;
  onVerifyCode?: () => void;
};

type WalletAuth = { onConnect?: () => void };

type LiquidLedgerScreenProps = {
  mode: LiquidLedgerMode;
  activeProvider?: Provider | null;
  contextLabel?: string;
  emailAuth?: EmailAuth;
  message?: string | null;
  onCancel?: () => void;
  onContinue?: () => void;
  continueLabel?: string;
  onLogin?: (provider: Provider) => void;
  onRecover?: () => void;
  onRetry?: () => void;
  recoveryBusy?: boolean;
  onSignOut?: () => void;
  presentation?: 'screen' | 'sheet';
  solanaAddress?: string | null;
  walletAuth?: WalletAuth;
};

const palette = {
  canvas: '#131918',
  surface: '#1C2523',
  ink: '#F2F5F1',
  muted: '#B8C4BF',
  proof: '#74C7DF',
  proofWash: '#163640',
  caution: '#FFAAA2',
  cautionWash: '#42201F',
  outline: '#51615C',
} as const;

const AuthThemeContext = createContext<ReturnType<typeof useTheme> | null>(null);

function useAuthTheme() {
  const theme = useTheme();
  return useContext(AuthThemeContext) ?? theme;
}

export function LiquidLedgerScreen({
  mode,
  activeProvider,
  contextLabel,
  emailAuth,
  message,
  onCancel,
  onLogin,
  onContinue,
  continueLabel,
  onRecover,
  onRetry,
  recoveryBusy = false,
  onSignOut,
  presentation = 'screen',
  solanaAddress,
  walletAuth,
}: LiquidLedgerScreenProps) {
  const copy = useMemo(() => screenCopy(mode), [mode]);
  const [sheetProvider, setSheetProvider] = useState<Provider | null>(null);
  const busy = mode === 'preparing' || Boolean(activeProvider) || recoveryBusy;
  const showAuth = mode === 'sign-in' || mode === 'web-preview';

  if (presentation === 'sheet') {
    return (
      <LiquidLedgerSheet
        key={showAuth ? 'auth' : `${mode}:${solanaAddress ?? ''}`}
        activeProvider={activeProvider}
        contextLabel={contextLabel}
        emailAuth={emailAuth}
        message={message}
        mode={mode}
        onCancel={onCancel}
        onContinue={onContinue}
        continueLabel={continueLabel}
        onChooseProvider={setSheetProvider}
        onLogin={onLogin}
        onRecover={onRecover}
        onRetry={onRetry}
        onSignOut={onSignOut}
        recoveryBusy={recoveryBusy}
        selectedProvider={sheetProvider}
        solanaAddress={solanaAddress}
        walletAuth={walletAuth}
      />
    );
  }

  return (
    <AuthThemeContext value={Colors.dark}>
      <View style={styles.background}>
      <StatusBar style="light" />
      <SafeAreaView edges={['top', 'bottom', 'left', 'right']} style={styles.safeArea}>
        <View style={styles.header}>
          <BrandLogo appearance="dark" />
          <Text style={styles.headerStatus}>{copy.status}</Text>
        </View>

        <ScrollView
          alwaysBounceVertical={false}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <View style={styles.shell}>
            {contextLabel ? (
              <View style={styles.contextBanner}>
                <Text style={styles.contextEyebrow}>YOUR TICKET IS SAVED</Text>
                <Text style={styles.contextText}>{contextLabel}</Text>
              </View>
            ) : null}

            <View style={styles.hero}>
              <View style={styles.heroMark}><ShieldIcon color={palette.proof} /></View>
              <Text style={styles.eyebrow}>{copy.eyebrow}</Text>
              <Text accessibilityRole="header" style={styles.title}>{copy.title}</Text>
              <Text style={styles.intro}>{copy.intro}</Text>
            </View>

            <View style={styles.panel}>
              {mode === 'preparing' ? (
                <View accessibilityLiveRegion="polite" style={styles.progress}>
                  <ActivityIndicator color={palette.proof} size="small" />
                  <View style={styles.progressCopy}>
                    <Text style={styles.progressTitle}>Preparing your account</Text>
                    <Text style={styles.progressBody}>{activeProvider ? `Finishing ${providerName(activeProvider)} sign-in…` : 'Restoring your Solana wallet securely…'}</Text>
                  </View>
                </View>
              ) : null}

              {mode === 'wallet-approval' ? (
                <View accessibilityLiveRegion="polite" style={styles.walletHandoff}>
                  <View style={styles.handoffIcons}>
                    <View style={styles.handoffMark}><WalletIcon color={palette.proof} /></View>
                    <Text style={styles.handoffArrow}>→</Text>
                    <View style={styles.handoffMark}><ShieldIcon color={palette.ink} size={22} /></View>
                  </View>
                  <ActivityIndicator color={palette.proof} size="small" />
                  <Text style={styles.handoffTitle}>Confirm in your wallet</Text>
                  <Text style={styles.handoffBody}>{message ?? 'Your Solana wallet is being opened to confirm control. No transaction or fee is involved.'}</Text>
                </View>
              ) : null}

              {showAuth ? (
                <>
                  {emailAuth ? (
                    <EmailAuthForm auth={emailAuth} disabled={busy} />
                  ) : (
                    <AuthButton
                      icon="email"
                      label="Continue with email"
                      onPress={() => onLogin?.('email')}
                      primary
                    />
                  )}
                  <View style={styles.divider}><View style={styles.dividerLine} /><Text style={styles.dividerText}>or</Text><View style={styles.dividerLine} /></View>
                  <AuthButton
                    disabled={busy}
                    icon="wallet"
                    label="Continue with Solana wallet"
                    onPress={walletAuth?.onConnect ?? (() => onLogin?.('external-wallet'))}
                  />
                  <View style={styles.safetyNote}>
                    <ShieldIcon color={palette.proof} size={17} />
                    <Text style={styles.safetyText}>Signing in never approves a trade or moves funds. Warren never stores your wallet keys.</Text>
                  </View>
                  {message ? <Notice message={message} /> : null}
                </>
              ) : null}

              {mode === 'ready' ? (
                <>
                  <WalletCard address={solanaAddress ?? null} />
                  <AuthButton icon="arrow" label={continueLabel ?? 'Return to Warren'} onPress={onContinue ?? onCancel} primary />
                  <AuthButton icon="sign-out" label="Sign out" onPress={onSignOut} />
                </>
              ) : null}

              {mode === 'error' ? (
                <>
                  <Notice message={message ?? 'Sign-in could not be completed.'} tone="error" />
                  {onRetry ? <AuthButton icon="retry" label="Try again" onPress={onRetry} primary /> : null}
                  {onSignOut ? <AuthButton icon="sign-out" label="Sign out" onPress={onSignOut} /> : null}
                </>
              ) : null}

              {mode === 'recovery-required' ? (
                <>
                  <Notice message={message ?? 'Your existing Solana wallet needs recovery on this device.'} tone="error" />
                  <AuthButton
                    disabled={recoveryBusy}
                    icon="retry"
                    label={recoveryBusy ? 'Recovering wallet…' : 'Recover wallet'}
                    onPress={onRecover}
                    primary
                  />
                  <AuthButton disabled={recoveryBusy} icon="sign-out" label="Sign out" onPress={onSignOut} />
                </>
              ) : null}

              {mode === 'missing-config' ? (
                <Notice message="Sign-in is not available in this build. You can keep browsing and try again after updating Warren." />
              ) : null}

              {mode === 'unsupported-platform' ? (
                <Notice message="Expo Go cannot run Warren sign-in or Solana wallet modules. Open Warren in its Android or iOS development build." />
              ) : null}

              {onCancel && mode !== 'ready' ? (
                <Pressable accessibilityRole="button" onPress={onCancel} style={({ pressed }) => [styles.keepBrowsing, pressed && styles.pressed]}>
                  <Text style={styles.keepBrowsingText}>Keep browsing</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
      </View>
    </AuthThemeContext>
  );
}

function LiquidLedgerSheet({
  activeProvider,
  contextLabel,
  emailAuth,
  message,
  mode,
  onCancel,
  onContinue,
  onChooseProvider,
  onLogin,
  onRecover,
  onRetry,
  onSignOut,
  recoveryBusy,
  selectedProvider,
  solanaAddress,
  continueLabel,
  walletAuth,
}: Omit<LiquidLedgerScreenProps, 'presentation'> & {
  onChooseProvider: (provider: Provider | null) => void;
  selectedProvider: Provider | null;
}) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const compact = width < 360;
  const showAuth = mode === 'sign-in' || mode === 'web-preview';
  const busy = mode === 'preparing' || Boolean(activeProvider) || Boolean(recoveryBusy);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const copy = receiveOpen ? { title: 'Deposit to Warren', intro: '' } : sheetCopy(mode, selectedProvider, emailAuth?.codeSent);
  const readyAddress = solanaAddress ?? null;

  const copyAddress = async () => {
    if (!readyAddress) return;
    try {
      await Clipboard.setStringAsync(readyAddress);
      setCopied(true);
      setCopyError(null);
    } catch {
      setCopyError('Could not copy the wallet address. Please try again.');
    }
  };

  return (
    <View style={[styles.sheetRoot, { backgroundColor: theme.canvas }]}>
      <View style={[styles.sheetHandle, { backgroundColor: theme.outline }]} />
      <View style={[styles.sheetHeader, compact && styles.sheetHeaderCompact]}>
        <View style={styles.sheetHeadingCopy}>
          <View style={styles.sheetTitleRow}>
            {showAuth && selectedProvider ? (
              <Pressable
                accessibilityLabel="Back to sign-in methods"
                accessibilityRole="button"
                disabled={busy}
                onPress={() => onChooseProvider(null)}
                style={({ pressed }) => [styles.sheetBack, pressed && styles.pressed]}>
                <Text style={[styles.sheetBackText, { color: theme.muted }]}>‹</Text>
              </Pressable>
            ) : null}
            <Text accessibilityRole="header" style={[styles.sheetTitle, { color: theme.ink }, compact && styles.sheetTitleCompact, showAuth && !selectedProvider && (compact ? styles.sheetTitleWelcomeCompact : styles.sheetTitleWelcome)]}>{copy.title}</Text>
            <Pressable
              accessibilityLabel="Close"
              accessibilityRole="button"
              hitSlop={6}
              onPress={onCancel}
              style={({ pressed }) => [styles.sheetClose, pressed && styles.pressed]}>
              <Text style={[styles.sheetCloseText, { color: theme.muted }]}>×</Text>
            </Pressable>
          </View>
          {copy.intro ? <Text style={[styles.sheetIntro, { color: theme.muted }]}>{copy.intro}</Text> : null}
        </View>
      </View>

      <ScrollView
        alwaysBounceVertical={false}
        contentContainerStyle={[styles.sheetScroll, compact && styles.sheetScrollCompact]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        {contextLabel ? (
          <View style={[styles.contextBanner, { backgroundColor: theme.proofWash }]}>
            <Text style={[styles.contextText, { color: theme.proof, marginTop: 0 }]}>{contextLabel}</Text>
          </View>
        ) : null}

        {mode === 'preparing' ? (
          <>
            <WalletCard address={null} preparing />
          </>
        ) : null}

        {mode === 'wallet-approval' ? (
          <View accessibilityLiveRegion="polite" style={[styles.walletHandoff, { backgroundColor: theme.surface, borderColor: theme.outline }]}>
            <View style={styles.handoffIcons}>
              <View style={[styles.handoffMark, { borderColor: theme.outline }]}><WalletIcon color={theme.proof} /></View>
              <Text style={[styles.handoffArrow, { color: theme.muted }]}>→</Text>
              <View style={[styles.handoffMark, { borderColor: theme.outline }]}><ShieldIcon color={theme.ink} size={22} /></View>
            </View>
            <ActivityIndicator color={theme.proof} size="small" />
            <Text style={[styles.handoffTitle, { color: theme.ink }]}>Confirm in your wallet</Text>
            <Text style={[styles.handoffBody, { color: theme.muted }]}>{message ?? 'Your Solana wallet is being opened to confirm control. No transaction or fee is involved.'}</Text>
          </View>
        ) : null}

        {showAuth && !selectedProvider ? (
          <>
            <View style={styles.authChoices}>
              <AuthChoice
                icon="email"
                label="Continue with email"
                onPress={() => onChooseProvider('email')}
                primary
                supporting="We’ll send you a verification code."
              />
              <AuthChoice
                icon="wallet"
                label="Continue with existing wallet"
                onPress={() => onChooseProvider('external-wallet')}
                supporting="Use a Solana wallet on this phone."
              />
            </View>
            <Pressable accessibilityRole="button" onPress={onCancel} style={({ pressed }) => [styles.sheetNotNow, pressed && styles.pressed]}>
              <Text style={[styles.sheetNotNowText, { color: theme.muted }]}>Keep exploring</Text>
            </Pressable>
            <AuthTrust />
          </>
        ) : null}

        {showAuth && selectedProvider === 'email' ? (
          <View style={styles.sheetMethod}>
            {emailAuth ? (
              <EmailAuthForm auth={emailAuth} disabled={busy} />
            ) : (
              <AuthButton
                disabled={busy}
                icon="email"
                label="Continue with email"
                onPress={() => onLogin?.('email')}
                primary
              />
            )}
            {message ? <Notice message={message} /> : null}
            <ChooseAnotherMethod disabled={busy} onPress={() => onChooseProvider(null)} />
          </View>
        ) : null}

        {showAuth && selectedProvider === 'external-wallet' ? (
          <View style={styles.sheetMethod}>
            <AuthButton
              disabled={busy}
              icon="wallet"
              label={activeProvider === 'external-wallet' ? 'Connecting wallet…' : 'Continue with existing wallet'}
              onPress={walletAuth?.onConnect ?? (() => onLogin?.('external-wallet'))}
              primary
            />
            {message ? <Notice message={message} /> : null}
            <SheetFact message="Your connected wallet signs you in. Warren prepares a separate wallet for your investments." />
            <ChooseAnotherMethod disabled={busy} onPress={() => onChooseProvider(null)} />
          </View>
        ) : null}

        {mode === 'ready' ? (
          <View style={styles.sheetMethod}>
            <WalletCard address={readyAddress} expanded={receiveOpen} />
            {receiveOpen ? (
              <>
                <SheetFact message="Send only supported assets on the Solana network to this address." />
                <AuthButton disabled={!readyAddress} icon="wallet" label={copied ? 'Address copied' : 'Copy address'} onPress={() => void copyAddress()} primary />
                {copyError ? <Notice message={copyError} tone="error" /> : null}
                <AuthButton icon="arrow" label="Done" onPress={() => { setReceiveOpen(false); setCopied(false); setCopyError(null); }} />
              </>
            ) : (
              <AuthButton disabled={!readyAddress} icon="arrow" label="Deposit funds" onPress={() => setReceiveOpen(true)} primary />
            )}
            {!receiveOpen ? <AuthButton disabled={!readyAddress} icon="arrow" label={continueLabel ?? 'Explore markets'} onPress={onContinue ?? onCancel} /> : null}
          </View>
        ) : null}

        {mode === 'error' ? (
          <View style={styles.sheetMethod}>
            <Notice message={message ?? 'Sign-in could not be completed.'} tone="error" />
            {onRetry ? <AuthButton icon="retry" label="Try again" onPress={onRetry} primary /> : null}
            {onSignOut ? <AuthButton icon="sign-out" label="Sign out" onPress={onSignOut} /> : null}
          </View>
        ) : null}

        {mode === 'recovery-required' ? (
          <View style={styles.sheetMethod}>
            <Notice message={message ?? 'Your existing Solana wallet needs recovery on this device.'} tone="error" />
            <AuthButton
              disabled={recoveryBusy}
              icon="retry"
              label={recoveryBusy ? 'Recovering wallet…' : 'Recover wallet'}
              onPress={onRecover}
              primary
            />
            <AuthButton disabled={recoveryBusy} icon="sign-out" label="Sign out" onPress={onSignOut} />
          </View>
        ) : null}

        {mode === 'missing-config' ? (
          <Notice message="Sign-in is not available in this build. You can keep browsing and try again after updating Warren." />
        ) : null}

        {mode === 'unsupported-platform' ? (
          <Notice message="Expo Go cannot run Warren sign-in or Solana wallet modules. Open Warren in its Android or iOS development build." />
        ) : null}
      </ScrollView>
    </View>
  );
}

function AuthChoice({
  icon,
  label,
  onPress,
  primary = false,
  supporting,
}: {
  icon: 'email' | 'wallet';
  label: string;
  onPress: () => void;
  primary?: boolean;
  supporting: string;
}) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const compact = width < 360;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.authChoice, compact && styles.authChoiceCompact, { backgroundColor: primary ? theme.proofWash : theme.surface, borderColor: primary ? `${theme.proof}66` : 'transparent' }, primary && styles.authChoicePrimary, pressed && styles.pressed]}>
      <View style={styles.authChoiceIcon}><AuthIcon color={theme.proof} name={icon} /></View>
      <View style={styles.authChoiceCopy}>
        <Text style={[styles.authChoiceLabel, { color: theme.ink }]}>{label}</Text>
        <Text style={[styles.authChoiceSupporting, { color: theme.muted }]}>{supporting}</Text>
      </View>
      <Text accessible={false} style={[styles.authChoiceArrow, { color: theme.muted }]}>›</Text>
    </Pressable>
  );
}

function ChooseAnotherMethod({ disabled, onPress }: { disabled: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.chooseAnother, pressed && styles.pressed, disabled && styles.disabled]}>
      <Text style={[styles.chooseAnotherText, { color: theme.muted }]}>Use another method</Text>
    </Pressable>
  );
}

function SheetFact({ message }: { message: string }) {
  const theme = useTheme();
  return <View style={styles.sheetFact}><Text style={[styles.sheetFactText, { color: theme.muted }]}>{message}</Text></View>;
}

function AuthTrust() {
  const theme = useTheme();
  return (
    <View style={styles.authTrust}>
      <ShieldIcon color={theme.proof} size={15} />
      <Text style={[styles.authTrustText, { color: theme.muted }]}>Secured by Privy</Text>
    </View>
  );
}

function EmailAuthForm({ auth, disabled }: { auth: EmailAuth; disabled: boolean }) {
  const theme = useAuthTheme();
  const { width } = useWindowDimensions();
  const compact = width < 360;
  if (auth.codeSent) {
    return (
      <View style={[styles.emailForm, styles.emailFormCode]}>
        <View style={styles.emailLine}>
          <Text numberOfLines={1} style={[styles.emailLineText, { color: theme.ink }]}>{auth.email || 'your email address'}</Text>
          <Pressable accessibilityRole="button" disabled={disabled || !auth.onReset} onPress={auth.onReset} style={({ pressed }) => [styles.authLink, pressed && styles.pressed]}>
            <Text style={[styles.authLinkText, { color: theme.proof }]}>Change email</Text>
          </Pressable>
        </View>
        <Text style={[styles.inputLabel, { color: theme.muted }]}>Verification code</Text>
        <TextInput
          accessibilityLabel="Six-digit email code"
          autoComplete="one-time-code"
          editable={!disabled}
          inputMode="numeric"
          keyboardType="number-pad"
          maxLength={6}
          onChangeText={auth.onCodeChange}
          onSubmitEditing={auth.onVerifyCode}
          placeholder="000000"
          placeholderTextColor={theme.muted}
          returnKeyType="done"
          style={[styles.input, styles.codeInput, compact && styles.codeInputCompact, { backgroundColor: theme.surface, borderColor: theme.outline, color: theme.ink }]}
          textContentType="oneTimeCode"
          value={auth.code}
        />
        {auth.message ? <Text accessibilityRole="alert" style={[styles.inputError, { color: theme.caution }]}>{auth.message}</Text> : null}
        <AuthButton disabled={disabled} icon="arrow" label="Verify email" onPress={auth.onVerifyCode} primary />
        <ResendCode auth={auth} disabled={disabled} />
      </View>
    );
  }

  return (
    <View style={styles.emailForm}>
      <Text style={[styles.inputLabel, { color: theme.muted }]}>Email address</Text>
      <TextInput
        accessibilityLabel="Email address"
        autoCapitalize="none"
        autoComplete="email"
        autoCorrect={false}
        editable={!disabled}
        inputMode="email"
        keyboardType="email-address"
        onChangeText={auth.onEmailChange}
        onSubmitEditing={auth.onSendCode}
        placeholder="you@example.com"
        placeholderTextColor={theme.muted}
        returnKeyType="send"
        style={[styles.input, { backgroundColor: theme.surface, borderColor: theme.outline, color: theme.ink }]}
        textContentType="emailAddress"
        value={auth.email}
      />
      {auth.message ? <Text accessibilityRole="alert" style={[styles.inputError, { color: theme.caution }]}>{auth.message}</Text> : null}
      <AuthButton disabled={disabled} icon="email" label="Send code" onPress={auth.onSendCode} primary />
    </View>
  );
}

function ResendCode({ auth, disabled }: { auth: EmailAuth; disabled: boolean }) {
  const theme = useAuthTheme();
  const [now, setNow] = useState(() => Date.now());
  const resendAt = auth.resendAvailableAt;
  useEffect(() => {
    if (!resendAt || normalizeDeadline(resendAt) <= Date.now()) return undefined;
    const deadline = normalizeDeadline(resendAt);
    const timer = setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= deadline) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [resendAt]);
  const remaining = resendAt ? Math.max(0, Math.ceil((normalizeDeadline(resendAt) - now) / 1000)) : 0;
  const resend = auth.onResendCode ?? auth.onSendCode;
  return (
    <View style={styles.resendRow}>
      <Text style={[styles.resendText, { color: theme.muted }]}>{remaining ? `Resend available in ${remaining}s` : 'Didn’t get a code?'}</Text>
      <Pressable accessibilityRole="button" disabled={disabled || remaining > 0 || !resend} onPress={resend} style={({ pressed }) => [styles.authLink, pressed && styles.pressed, (disabled || remaining > 0 || !resend) && styles.disabled]}>
        <Text style={[styles.authLinkText, { color: theme.proof }]}>Resend code</Text>
      </Pressable>
    </View>
  );
}

function normalizeDeadline(value: number) {
  return value < 10_000_000_000 ? value * 1000 : value;
}

function AuthButton({ disabled, icon, label, onPress, primary = false }: { disabled?: boolean; icon: 'arrow' | 'email' | 'retry' | 'sign-out' | 'wallet'; label: string; onPress?: () => void; primary?: boolean }) {
  const theme = useAuthTheme();
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || !onPress}
      onPress={onPress}
      style={({ pressed }) => [styles.button, { backgroundColor: primary ? theme.proof : `${theme.muted}0D` }, pressed && styles.pressed, (disabled || !onPress) && styles.disabled]}>
      <AuthIcon color={primary ? theme.onProof : theme.proof} name={icon} />
      <Text style={[styles.buttonText, { color: primary ? theme.onProof : theme.ink }]}>{label}</Text>
      <Text accessible={false} style={[styles.buttonArrow, { color: primary ? theme.onProof : theme.ink }]}>→</Text>
    </Pressable>
  );
}

function Notice({ message, tone = 'information' }: { message: string; tone?: 'error' | 'information' }) {
  const theme = useAuthTheme();
  return (
    <View accessibilityLiveRegion="polite" style={[styles.notice, { backgroundColor: tone === 'error' ? theme.cautionWash : theme.proofWash }, tone === 'error' && styles.errorNotice]}>
      <Text style={[styles.noticeText, { color: tone === 'error' ? theme.caution : theme.muted }]}>{message}</Text>
    </View>
  );
}

function AuthIcon({ color, name }: { color: string; name: 'arrow' | 'email' | 'retry' | 'sign-out' | 'wallet' }) {
  if (name === 'email') {
    return <Svg fill="none" height={19} viewBox="0 0 24 24" width={19}><Rect height={14} rx={2.5} stroke={color} strokeWidth={1.8} width={18} x={3} y={5} /><Path d="m4.5 7 7.5 6 7.5-6" stroke={color} strokeLinejoin="round" strokeWidth={1.8} /></Svg>;
  }
  if (name === 'wallet') return <WalletIcon color={color} />;
  if (name === 'retry') return <Svg fill="none" height={19} viewBox="0 0 24 24" width={19}><Path d="M19 8a8 8 0 1 0 1 7M19 4v4h-4" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} /></Svg>;
  if (name === 'sign-out') return <Svg fill="none" height={19} viewBox="0 0 24 24" width={19}><Path d="M10 5H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4m5-4 4-3-4-3m4 3H9" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} /></Svg>;
  return <Svg fill="none" height={19} viewBox="0 0 24 24" width={19}><Path d="M5 12h14m-5-5 5 5-5 5" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} /></Svg>;
}

function WalletIcon({ color }: { color: string }) {
  return <Svg fill="none" height={19} viewBox="0 0 24 24" width={19}><Rect height={13} rx={2.5} stroke={color} strokeWidth={1.8} width={17} x={3.5} y={6} /><Path d="M3.5 10h17M16.5 13.5H18" stroke={color} strokeLinecap="round" strokeWidth={1.8} /></Svg>;
}

function ShieldIcon({ color, size = 22 }: { color: string; size?: number }) {
  return <Svg fill="none" height={size} viewBox="0 0 24 24" width={size}><Path d="M12 3 5 6v5c0 4.5 2.8 7.7 7 10 4.2-2.3 7-5.5 7-10V6l-7-3Z" stroke={color} strokeLinejoin="round" strokeWidth={1.8} /><Path d="m9 12 2 2 4-4" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} /></Svg>;
}

function screenCopy(mode: LiquidLedgerMode) {
  switch (mode) {
    case 'ready': return { status: 'Signed in', eyebrow: 'ACCOUNT READY', title: 'Your Solana account is ready.', intro: 'Your portfolio and Warren-recognized activity can now load from the wallet linked to this Privy session.' };
    case 'preparing': return { status: 'Securing', eyebrow: 'PRIVATE ACCOUNT', title: 'Restoring your Warren account.', intro: 'Keep Warren open while Privy finishes sign-in and prepares your Solana wallet.' };
    case 'wallet-approval': return { status: 'Confirming', eyebrow: 'EXISTING WALLET', title: 'Confirm in your wallet.', intro: 'Your Solana wallet is being opened to confirm control. No transaction or fee is involved.' };
    case 'missing-config': return { status: 'Not configured', eyebrow: 'THIS BUILD', title: 'Sign-in is not ready here.', intro: 'You can keep browsing public markets. A configured Warren build is required for private portfolio access.' };
    case 'unsupported-platform': return { status: 'Development build', eyebrow: 'EXPO GO', title: 'Open the Warren development build.', intro: 'Privy and Solana wallet modules require Warren’s native development build and cannot run inside Expo Go.' };
    case 'web-preview': return { status: 'Preview', eyebrow: 'PRIVATE ACCOUNT', title: 'Your portfolio, when you want it.', intro: 'Use email or a Solana wallet in the native Warren app to create or restore your private account.' };
    case 'error': return { status: 'Try again', eyebrow: 'NOTHING MOVED', title: 'Sign-in did not finish.', intro: 'Your funds and saved companies are unchanged. Retry the same account safely.' };
    case 'recovery-required': return { status: 'Recovery', eyebrow: 'EXISTING WALLET', title: 'Recover the same wallet.', intro: 'Warren will not create a replacement while your existing Solana wallet needs recovery on this device.' };
    default: return { status: 'Sign in', eyebrow: 'PRIVATE ACCOUNT', title: 'Your portfolio, when you want it.', intro: 'Continue with email or prove control of a Solana wallet. Warren will create or restore one private account.' };
  }
}

function sheetCopy(mode: LiquidLedgerMode, provider: Provider | null, codeSent = false) {
  if ((mode === 'sign-in' || mode === 'web-preview') && provider === 'email') {
    return {
      title: codeSent ? 'Check your email' : 'What’s your email?',
      intro: codeSent ? 'Enter the 6-digit code sent to' : 'We’ll send a code to sign you in. No password needed.',
    };
  }
  if ((mode === 'sign-in' || mode === 'web-preview') && provider === null) {
    return {
      title: 'Welcome to Warren',
      intro: 'Sign in or create your account.',
    };
  }
  if ((mode === 'sign-in' || mode === 'web-preview') && provider === 'external-wallet') {
    return {
      title: 'Choose a wallet',
      intro: 'Use a Solana wallet on this phone to sign in.',
    };
  }
  switch (mode) {
    case 'wallet-approval':
      return { title: 'Sign in to Warren', intro: 'Confirm this request in your Solana wallet.' };
    case 'preparing':
      return { title: 'Getting your wallet ready', intro: 'Keep Warren open while we prepare your Warren wallet.' };
    case 'ready':
      return { title: 'Your wallet is ready', intro: 'Deposit funds when you’re ready to invest.' };
    case 'error':
      return { title: 'Sign-in needs attention', intro: 'Nothing moved. Retry the same account safely.' };
    case 'recovery-required':
      return { title: 'Recover the same wallet', intro: 'Warren will not create a replacement for your existing Solana wallet.' };
    case 'missing-config':
      return { title: 'Sign-in is not configured', intro: 'This build is not configured for private Warren accounts.' };
    case 'unsupported-platform':
      return { title: 'Open the Warren development build', intro: 'Expo Go cannot load the native Privy and Solana wallet modules used by Warren.' };
    default:
      return { title: 'Sign in to Warren', intro: 'Restore your portfolio or create an account. Signing in never approves a trade or moves funds.' };
  }
}

function providerName(provider: Provider) {
  return provider === 'email' ? 'email' : 'wallet';
}

const styles = StyleSheet.create({
  background: { backgroundColor: palette.canvas, flex: 1 },
  safeArea: { flex: 1 },
  header: { alignItems: 'center', borderBottomColor: 'rgba(81,97,92,0.58)', borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', justifyContent: 'space-between', minHeight: 64, paddingHorizontal: 20 },
  headerStatus: { color: palette.muted, fontFamily: Fonts.sans, fontSize: 12, fontWeight: '700' },
  scrollContent: { flexGrow: 1 },
  shell: { alignSelf: 'center', flex: 1, maxWidth: 430, paddingBottom: 22, paddingHorizontal: 20, width: '100%' },
  contextBanner: { backgroundColor: palette.proofWash, borderRadius: 14, marginTop: 14, paddingHorizontal: 14, paddingVertical: 12 },
  contextEyebrow: { color: palette.proof, fontFamily: Fonts.mono, fontSize: 9, fontWeight: '700', letterSpacing: 1 },
  contextText: { color: palette.ink, fontFamily: Fonts.sans, fontSize: 12, lineHeight: 18, marginTop: 4 },
  hero: { paddingBottom: 25, paddingTop: 38 },
  heroMark: { alignItems: 'center', backgroundColor: palette.proofWash, borderRadius: 18, height: 54, justifyContent: 'center', marginBottom: 23, width: 54 },
  eyebrow: { color: palette.proof, fontFamily: Fonts.mono, fontSize: 10, fontWeight: '700', letterSpacing: 1.15 },
  title: { color: palette.ink, fontFamily: Fonts.sans, fontSize: 34, fontWeight: '800', letterSpacing: -1.5, lineHeight: 39, marginTop: 9 },
  intro: { color: palette.muted, fontFamily: Fonts.sans, fontSize: 14, lineHeight: 21, marginTop: 12, maxWidth: 370 },
  panel: { backgroundColor: palette.surface, borderRadius: 22, gap: 11, padding: 16 },
  progress: { alignItems: 'center', flexDirection: 'row', gap: 13, minHeight: 76, paddingHorizontal: 5 },
  progressCopy: { flex: 1 },
  progressTitle: { color: palette.ink, fontFamily: Fonts.sans, fontSize: 14, fontWeight: '700' },
  progressBody: { color: palette.muted, fontFamily: Fonts.sans, fontSize: 12, lineHeight: 18, marginTop: 4 },
  inputLabel: { color: palette.muted, fontFamily: Fonts.sans, fontSize: 12, fontWeight: '500', marginLeft: 2 },
  input: { backgroundColor: palette.surface, borderColor: palette.outline, borderRadius: 13, borderWidth: 1, color: palette.ink, fontFamily: Fonts.sans, fontSize: 16, height: 57, paddingHorizontal: 15, paddingVertical: 0 },
  codeInput: { fontFamily: Fonts.mono, fontSize: 29, letterSpacing: 5, paddingLeft: 20, textAlign: 'center' },
  codeInputCompact: { fontSize: 25 },
  inputError: { color: palette.caution, fontFamily: Fonts.sans, fontSize: 11, lineHeight: 16, paddingHorizontal: 2 },
  button: { alignItems: 'center', borderRadius: 14, flexDirection: 'row', gap: 11, minHeight: 50, paddingHorizontal: 15 },
  buttonText: { color: palette.ink, flex: 1, fontFamily: Fonts.sans, fontSize: 14, fontWeight: '600' },
  buttonArrow: { color: palette.ink, fontFamily: Fonts.sans, fontSize: 18 },
  disabled: { opacity: 0.48 },
  pressed: { opacity: 0.74, transform: [{ scale: 0.992 }] },
  divider: { alignItems: 'center', flexDirection: 'row', gap: 10, marginVertical: 1 },
  dividerLine: { backgroundColor: 'rgba(81,97,92,0.55)', flex: 1, height: StyleSheet.hairlineWidth },
  dividerText: { color: palette.muted, fontFamily: Fonts.sans, fontSize: 11 },
  safetyNote: { alignItems: 'flex-start', flexDirection: 'row', gap: 9, paddingHorizontal: 3, paddingTop: 4 },
  safetyText: { color: palette.muted, flex: 1, fontFamily: Fonts.sans, fontSize: 11, lineHeight: 17 },
  notice: { backgroundColor: 'rgba(116,199,223,0.08)', borderRadius: 13, padding: 12 },
  noticeText: { color: palette.muted, fontFamily: Fonts.sans, fontSize: 12, lineHeight: 18 },
  errorNotice: { backgroundColor: palette.cautionWash },
  keepBrowsing: { alignItems: 'center', justifyContent: 'center', minHeight: 46 },
  keepBrowsingText: { color: palette.muted, fontFamily: Fonts.sans, fontSize: 13, fontWeight: '700' },
  sheetRoot: { flexShrink: 1, maxHeight: '100%' },
  sheetHandle: { alignSelf: 'center', backgroundColor: 'rgba(241,245,242,.22)', borderRadius: 2, height: 4, marginBottom: 4, marginTop: 10, width: 40 },
  sheetHeader: { alignItems: 'center', flexDirection: 'row', gap: 8, paddingHorizontal: 20, paddingTop: 12 },
  sheetHeaderCompact: { paddingHorizontal: 14 },
  sheetBack: { alignItems: 'center', height: 44, justifyContent: 'center', marginLeft: -7, width: 36 },
  sheetBackText: { color: palette.muted, fontFamily: Fonts.sans, fontSize: 28, lineHeight: 30 },
  sheetHeadingCopy: { flex: 1, minWidth: 0, paddingTop: 3 },
  sheetTitleRow: { alignItems: 'center', flexDirection: 'row', gap: 8, justifyContent: 'space-between' },
  sheetTitle: { color: palette.ink, flex: 1, fontFamily: Fonts.sans, fontSize: 25, fontWeight: '600', letterSpacing: -1, lineHeight: 30 },
  sheetTitleCompact: { fontSize: 23, lineHeight: 28 },
  sheetTitleWelcome: { fontSize: 29, lineHeight: 34 },
  sheetTitleWelcomeCompact: { fontSize: 27, lineHeight: 32 },
  sheetIntro: { color: palette.muted, fontFamily: Fonts.sans, fontSize: 13, lineHeight: 20, marginTop: 7 },
  sheetClose: { alignItems: 'center', height: 44, justifyContent: 'center', width: 36 },
  sheetCloseText: { color: palette.muted, fontFamily: Fonts.sans, fontSize: 25, lineHeight: 27 },
  sheetScroll: { paddingBottom: 18, paddingHorizontal: 20, paddingTop: 16 },
  sheetScrollCompact: { paddingHorizontal: 16 },
  authChoices: { gap: 10, marginTop: 10 },
  authChoiceCompact: { gap: 8, paddingHorizontal: 11, paddingVertical: 12 },
  authChoice: { alignItems: 'center', backgroundColor: palette.surface, borderRadius: 16, flexDirection: 'row', gap: 11, minHeight: 82, paddingHorizontal: 14, paddingVertical: 15 },
  authChoicePrimary: { borderWidth: 1 },
  authChoiceIcon: { alignItems: 'center', height: 36, justifyContent: 'center', width: 32 },
  authChoiceCopy: { flex: 1, minWidth: 0 },
  authChoiceLabel: { color: palette.ink, fontFamily: Fonts.sans, fontSize: 14, fontWeight: '600', lineHeight: 19 },
  authChoiceSupporting: { color: palette.muted, fontFamily: Fonts.sans, fontSize: 11, lineHeight: 16, marginTop: 4 },
  authChoiceArrow: { color: palette.muted, fontFamily: Fonts.sans, fontSize: 20 },
  sheetFact: { marginTop: 18 },
  sheetFactText: { color: palette.muted, fontFamily: Fonts.sans, fontSize: 11, lineHeight: 18 },
  sheetNotNow: { alignItems: 'center', justifyContent: 'center', marginTop: 20, minHeight: 44 },
  sheetNotNowText: { color: palette.muted, fontFamily: Fonts.sans, fontSize: 12, fontWeight: '500' },
  authTrust: { alignItems: 'center', flexDirection: 'row', gap: 7, justifyContent: 'center', marginTop: 14 },
  authTrustText: { color: palette.muted, fontFamily: Fonts.sans, fontSize: 10 },
  sheetMethod: { gap: 11 },
  chooseAnother: { alignItems: 'center', justifyContent: 'center', minHeight: 44 },
  chooseAnotherText: { color: palette.muted, fontFamily: Fonts.sans, fontSize: 13, fontWeight: '700' },
  emailForm: { gap: 9, marginTop: 26 },
  emailFormCode: { marginTop: 5 },
  emailLine: { alignItems: 'center', flexDirection: 'row', gap: 8, justifyContent: 'space-between', marginBottom: 19 },
  emailLineText: { color: palette.ink, flex: 1, fontFamily: Fonts.sans, fontSize: 13, fontWeight: '500' },
  authLink: { alignItems: 'center', justifyContent: 'center', minHeight: 44, paddingHorizontal: 3 },
  authLinkText: { color: palette.proof, fontFamily: Fonts.sans, fontSize: 12, fontWeight: '500' },
  resendRow: { alignItems: 'center', flexDirection: 'row', gap: 10, justifyContent: 'space-between', marginTop: 8 },
  resendText: { color: palette.muted, flex: 1, fontFamily: Fonts.sans, fontSize: 11 },
  walletHandoff: { alignItems: 'center', backgroundColor: palette.surface, borderColor: palette.outline, borderRadius: 18, borderWidth: 1, marginTop: 24, paddingHorizontal: 18, paddingVertical: 25 },
  handoffIcons: { alignItems: 'center', flexDirection: 'row', gap: 21, justifyContent: 'center', marginBottom: 23, marginTop: 2 },
  handoffMark: { alignItems: 'center', borderColor: palette.outline, borderRadius: 15, borderWidth: 1, height: 48, justifyContent: 'center', width: 48 },
  handoffArrow: { color: palette.muted, fontFamily: Fonts.sans, fontSize: 18 },
  handoffTitle: { color: palette.ink, fontFamily: Fonts.sans, fontSize: 15, fontWeight: '600', marginTop: 12 },
  handoffBody: { color: palette.muted, fontFamily: Fonts.sans, fontSize: 13, lineHeight: 21, marginTop: 8, textAlign: 'center' },
  copyAddress: { alignItems: 'center', justifyContent: 'center', minHeight: 44 },
  copyAddressText: { color: palette.proof, fontFamily: Fonts.sans, fontSize: 12, fontWeight: '500' },
});
