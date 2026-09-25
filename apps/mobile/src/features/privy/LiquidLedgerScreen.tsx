import { StatusBar } from 'expo-status-bar';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path, Rect } from 'react-native-svg';

import { BrandLogo } from '@/components/brand-logo';
import { Fonts } from '@/constants/theme';

export type LiquidLedgerMode =
  | 'sign-in'
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
  onCodeChange?: (code: string) => void;
  onEmailChange?: (email: string) => void;
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

export function LiquidLedgerScreen({
  mode,
  activeProvider,
  contextLabel,
  emailAuth,
  message,
  onCancel,
  onLogin,
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
        key={showAuth ? 'auth' : mode}
        activeProvider={activeProvider}
        contextLabel={contextLabel}
        emailAuth={emailAuth}
        message={message}
        mode={mode}
        onCancel={onCancel}
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
                  <WalletCard address={solanaAddress} />
                  <AuthButton icon="arrow" label="Return to Warren" onPress={onCancel} primary />
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
  );
}

function LiquidLedgerSheet({
  activeProvider,
  contextLabel,
  emailAuth,
  message,
  mode,
  onCancel,
  onChooseProvider,
  onLogin,
  onRecover,
  onRetry,
  onSignOut,
  recoveryBusy,
  selectedProvider,
  solanaAddress,
  walletAuth,
}: Omit<LiquidLedgerScreenProps, 'presentation'> & {
  onChooseProvider: (provider: Provider | null) => void;
  selectedProvider: Provider | null;
}) {
  const showAuth = mode === 'sign-in' || mode === 'web-preview';
  const busy = mode === 'preparing' || Boolean(activeProvider) || Boolean(recoveryBusy);
  const copy = sheetCopy(mode, selectedProvider);

  return (
    <View style={styles.sheetRoot}>
      <View style={styles.sheetHandle} />
      <View style={styles.sheetHeader}>
        <View style={styles.sheetHeadingCopy}>
          <Text accessibilityRole="header" style={styles.sheetTitle}>{copy.title}</Text>
          <Text style={styles.sheetIntro}>{copy.intro}</Text>
        </View>
        <Pressable
          accessibilityLabel="Close"
          accessibilityRole="button"
          hitSlop={6}
          onPress={onCancel}
          style={({ pressed }) => [styles.sheetClose, pressed && styles.pressed]}>
          <Text style={styles.sheetCloseText}>×</Text>
        </Pressable>
      </View>

      <ScrollView
        alwaysBounceVertical={false}
        contentContainerStyle={styles.sheetScroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        {contextLabel ? (
          <View style={styles.contextBanner}>
            <Text style={styles.contextEyebrow}>YOUR TICKET IS SAVED</Text>
            <Text style={styles.contextText}>{contextLabel}</Text>
          </View>
        ) : null}

        {mode === 'preparing' ? (
          <View accessibilityLiveRegion="polite" style={styles.progress}>
            <ActivityIndicator color={palette.proof} size="small" />
            <View style={styles.progressCopy}>
              <Text style={styles.progressTitle}>Preparing your account</Text>
              <Text style={styles.progressBody}>{activeProvider ? `Finishing ${providerName(activeProvider)} sign-in…` : 'Restoring your Solana wallet securely…'}</Text>
            </View>
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
                supporting="Create or restore your account and Warren wallet."
              />
              <AuthChoice
                icon="wallet"
                label="Use an existing wallet"
                onPress={() => onChooseProvider('external-wallet')}
                supporting="Connect a Solana wallet, then confirm control with a message."
              />
            </View>
            <SheetFact message="Secure wallet infrastructure by Privy. Companies saved on this device remain available." />
            <Pressable accessibilityRole="button" onPress={onCancel} style={({ pressed }) => [styles.sheetNotNow, pressed && styles.pressed]}>
              <Text style={styles.sheetNotNowText}>Not now</Text>
            </Pressable>
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
            <SheetFact message="Privy securely creates or restores the same Warren account and embedded Solana wallet." />
            <ChooseAnotherMethod disabled={busy} onPress={() => onChooseProvider(null)} />
          </View>
        ) : null}

        {showAuth && selectedProvider === 'external-wallet' ? (
          <View style={styles.sheetMethod}>
            <AuthButton
              disabled={busy}
              icon="wallet"
              label={activeProvider === 'external-wallet' ? 'Connecting wallet…' : 'Connect Solana wallet'}
              onPress={walletAuth?.onConnect ?? (() => onLogin?.('external-wallet'))}
              primary
            />
            {message ? <Notice message={message} /> : null}
            <SheetFact message="The signature confirms wallet control. It is not a transaction and has no network fee." />
            <ChooseAnotherMethod disabled={busy} onPress={() => onChooseProvider(null)} />
          </View>
        ) : null}

        {mode === 'ready' ? (
          <View style={styles.sheetMethod}>
            <WalletCard address={solanaAddress} />
            <AuthButton icon="arrow" label="Return to Warren" onPress={onCancel} primary />
            <AuthButton icon="sign-out" label="Sign out" onPress={onSignOut} />
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
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.authChoice, primary && styles.authChoicePrimary, pressed && styles.pressed]}>
      <View style={styles.authChoiceIcon}><AuthIcon color={palette.proof} name={icon} /></View>
      <View style={styles.authChoiceCopy}>
        <Text style={styles.authChoiceLabel}>{label}</Text>
        <Text style={styles.authChoiceSupporting}>{supporting}</Text>
      </View>
      <Text accessible={false} style={styles.authChoiceArrow}>›</Text>
    </Pressable>
  );
}

function ChooseAnotherMethod({ disabled, onPress }: { disabled: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.chooseAnother, pressed && styles.pressed, disabled && styles.disabled]}>
      <Text style={styles.chooseAnotherText}>Choose another method</Text>
    </Pressable>
  );
}

function SheetFact({ message }: { message: string }) {
  return <View style={styles.sheetFact}><Text style={styles.sheetFactText}>{message}</Text></View>;
}

function EmailAuthForm({ auth, disabled }: { auth: EmailAuth; disabled: boolean }) {
  if (auth.codeSent) {
    return (
      <View style={styles.emailForm}>
        <Text style={styles.inputLabel}>Code sent to {auth.email}</Text>
        <TextInput
          accessibilityLabel="Six-digit email code"
          autoComplete="one-time-code"
          editable={!disabled}
          inputMode="numeric"
          keyboardType="number-pad"
          maxLength={6}
          onChangeText={auth.onCodeChange}
          onSubmitEditing={auth.onVerifyCode}
          placeholder="6-digit code"
          placeholderTextColor="rgba(184,196,191,0.58)"
          returnKeyType="done"
          style={styles.input}
          textContentType="oneTimeCode"
          value={auth.code}
        />
        {auth.message ? <Text style={styles.inputError}>{auth.message}</Text> : null}
        <AuthButton disabled={disabled} icon="arrow" label="Verify email" onPress={auth.onVerifyCode} primary />
        <Pressable accessibilityRole="button" disabled={disabled || !auth.onReset} onPress={auth.onReset} style={({ pressed }) => [styles.changeEmail, pressed && styles.pressed]}>
          <Text style={styles.changeEmailText}>Use a different email</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.emailForm}>
      <Text style={styles.inputLabel}>Email</Text>
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
        placeholderTextColor="rgba(184,196,191,0.58)"
        returnKeyType="send"
        style={styles.input}
        textContentType="emailAddress"
        value={auth.email}
      />
      {auth.message ? <Text style={styles.inputError}>{auth.message}</Text> : null}
      <AuthButton disabled={disabled} icon="email" label="Continue with email" onPress={auth.onSendCode} primary />
    </View>
  );
}

function WalletCard({ address }: { address?: string | null }) {
  return (
    <View accessibilityLabel={address ? `Solana wallet ${shortenAddress(address)} ready` : 'Solana wallet ready'} style={styles.walletCard}>
      <View style={styles.walletGlyph}><WalletIcon color={palette.proof} /></View>
      <View style={styles.walletCopy}>
        <Text style={styles.walletLabel}>ACTIVE WALLET</Text>
        <Text style={styles.walletTitle}>Warren wallet</Text>
        <Text numberOfLines={1} style={styles.walletAddress}>{address ? shortenAddress(address) : 'Solana wallet ready'}</Text>
      </View>
      <Text style={styles.walletReady}>● Ready</Text>
    </View>
  );
}

function AuthButton({ disabled, icon, label, onPress, primary = false }: { disabled?: boolean; icon: 'arrow' | 'email' | 'retry' | 'sign-out' | 'wallet'; label: string; onPress?: () => void; primary?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || !onPress}
      onPress={onPress}
      style={({ pressed }) => [styles.button, primary ? styles.primaryButton : styles.secondaryButton, pressed && styles.pressed, (disabled || !onPress) && styles.disabled]}>
      <AuthIcon color={primary ? palette.canvas : palette.proof} name={icon} />
      <Text style={[styles.buttonText, primary && styles.primaryButtonText]}>{label}</Text>
      <Text accessible={false} style={[styles.buttonArrow, primary && styles.primaryButtonText]}>→</Text>
    </Pressable>
  );
}

function Notice({ message, tone = 'information' }: { message: string; tone?: 'error' | 'information' }) {
  return (
    <View accessibilityLiveRegion="polite" style={[styles.notice, tone === 'error' && styles.errorNotice]}>
      <Text style={[styles.noticeText, tone === 'error' && styles.errorNoticeText]}>{message}</Text>
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
    case 'missing-config': return { status: 'Not configured', eyebrow: 'THIS BUILD', title: 'Sign-in is not ready here.', intro: 'You can keep browsing public markets. A configured Warren build is required for private portfolio access.' };
    case 'unsupported-platform': return { status: 'Development build', eyebrow: 'EXPO GO', title: 'Open the Warren development build.', intro: 'Privy and Solana wallet modules require Warren’s native development build and cannot run inside Expo Go.' };
    case 'web-preview': return { status: 'Preview', eyebrow: 'PRIVATE ACCOUNT', title: 'Your portfolio, when you want it.', intro: 'Use email or a Solana wallet in the native Warren app to create or restore your private account.' };
    case 'error': return { status: 'Try again', eyebrow: 'NOTHING MOVED', title: 'Sign-in did not finish.', intro: 'Your funds and saved companies are unchanged. Retry the same account safely.' };
    case 'recovery-required': return { status: 'Recovery', eyebrow: 'EXISTING WALLET', title: 'Recover the same wallet.', intro: 'Warren will not create a replacement while your existing Solana wallet needs recovery on this device.' };
    default: return { status: 'Sign in', eyebrow: 'PRIVATE ACCOUNT', title: 'Your portfolio, when you want it.', intro: 'Continue with email or prove control of a Solana wallet. Warren will create or restore one private account.' };
  }
}

function sheetCopy(mode: LiquidLedgerMode, provider: Provider | null) {
  if ((mode === 'sign-in' || mode === 'web-preview') && provider === 'email') {
    return {
      title: 'Continue with email',
      intro: 'Enter your email to create or restore your private Warren account and Solana wallet.',
    };
  }
  if ((mode === 'sign-in' || mode === 'web-preview') && provider === 'external-wallet') {
    return {
      title: 'Use an existing wallet',
      intro: 'Connect a compatible Solana wallet, then sign a message to confirm control of the address.',
    };
  }
  switch (mode) {
    case 'preparing':
      return { title: 'Finishing sign in', intro: 'Keep Warren open while Privy restores your account and Solana wallet.' };
    case 'ready':
      return { title: 'Account ready', intro: 'Your private Portfolio can now load from this Solana wallet.' };
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

function shortenAddress(address: string) {
  return address.length <= 15 ? address : `${address.slice(0, 6)}…${address.slice(-5)}`;
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
  emailForm: { gap: 9 },
  inputLabel: { color: palette.muted, fontFamily: Fonts.sans, fontSize: 11, fontWeight: '700', marginLeft: 2 },
  input: { backgroundColor: palette.canvas, borderColor: palette.outline, borderRadius: 14, borderWidth: 1, color: palette.ink, fontFamily: Fonts.sans, fontSize: 15, height: 54, paddingHorizontal: 15, paddingVertical: 0 },
  inputError: { color: palette.caution, fontFamily: Fonts.sans, fontSize: 11, lineHeight: 16, paddingHorizontal: 2 },
  button: { alignItems: 'center', borderRadius: 14, flexDirection: 'row', gap: 11, minHeight: 54, paddingHorizontal: 15 },
  primaryButton: { backgroundColor: palette.proof },
  secondaryButton: { backgroundColor: 'rgba(242,245,241,0.055)' },
  buttonText: { color: palette.ink, flex: 1, fontFamily: Fonts.sans, fontSize: 14, fontWeight: '800' },
  primaryButtonText: { color: palette.canvas },
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
  errorNoticeText: { color: palette.caution },
  keepBrowsing: { alignItems: 'center', justifyContent: 'center', minHeight: 46 },
  keepBrowsingText: { color: palette.muted, fontFamily: Fonts.sans, fontSize: 13, fontWeight: '700' },
  changeEmail: { alignItems: 'center', justifyContent: 'center', minHeight: 40 },
  sheetRoot: { flexShrink: 1, maxHeight: '100%' },
  sheetHandle: { alignSelf: 'center', backgroundColor: 'rgba(241,245,242,.22)', borderRadius: 2, height: 4, marginBottom: 4, marginTop: 10, width: 40 },
  sheetHeader: { alignItems: 'flex-start', flexDirection: 'row', gap: 14, paddingHorizontal: 20, paddingTop: 12 },
  sheetHeadingCopy: { flex: 1, minWidth: 0, paddingTop: 3 },
  sheetTitle: { color: palette.ink, fontFamily: Fonts.sans, fontSize: 23, fontWeight: '800', letterSpacing: -0.8, lineHeight: 27 },
  sheetIntro: { color: palette.muted, fontFamily: Fonts.sans, fontSize: 13, lineHeight: 20, marginTop: 7 },
  sheetClose: { alignItems: 'center', backgroundColor: 'rgba(241,245,242,.055)', borderRadius: 14, height: 44, justifyContent: 'center', width: 44 },
  sheetCloseText: { color: palette.muted, fontFamily: Fonts.sans, fontSize: 25, lineHeight: 27 },
  sheetScroll: { paddingBottom: 18, paddingHorizontal: 20, paddingTop: 16 },
  authChoices: { gap: 10 },
  authChoice: { alignItems: 'center', backgroundColor: 'rgba(241,245,242,.045)', borderRadius: 16, flexDirection: 'row', gap: 12, minHeight: 76, padding: 12 },
  authChoicePrimary: { backgroundColor: palette.proofWash },
  authChoiceIcon: { alignItems: 'center', backgroundColor: 'rgba(241,245,242,.06)', borderRadius: 12, height: 40, justifyContent: 'center', width: 40 },
  authChoiceCopy: { flex: 1, minWidth: 0 },
  authChoiceLabel: { color: palette.ink, fontFamily: Fonts.sans, fontSize: 14, fontWeight: '700' },
  authChoiceSupporting: { color: palette.muted, fontFamily: Fonts.sans, fontSize: 11, lineHeight: 16, marginTop: 4 },
  authChoiceArrow: { color: palette.muted, fontFamily: Fonts.sans, fontSize: 20 },
  sheetFact: { backgroundColor: 'rgba(241,245,242,.045)', borderRadius: 13, marginTop: 15, padding: 13 },
  sheetFactText: { color: palette.muted, fontFamily: Fonts.sans, fontSize: 12, lineHeight: 18 },
  sheetNotNow: { alignItems: 'center', justifyContent: 'center', marginTop: 4, minHeight: 46 },
  sheetNotNowText: { color: palette.muted, fontFamily: Fonts.sans, fontSize: 13, fontWeight: '700' },
  sheetMethod: { gap: 11 },
  chooseAnother: { alignItems: 'center', justifyContent: 'center', minHeight: 44 },
  chooseAnotherText: { color: palette.muted, fontFamily: Fonts.sans, fontSize: 13, fontWeight: '700' },
  changeEmailText: { color: palette.muted, fontFamily: Fonts.sans, fontSize: 12, fontWeight: '700' },
  walletCard: { alignItems: 'center', backgroundColor: palette.canvas, borderRadius: 17, flexDirection: 'row', gap: 12, marginBottom: 4, padding: 14 },
  walletGlyph: { alignItems: 'center', backgroundColor: palette.proofWash, borderRadius: 13, height: 42, justifyContent: 'center', width: 42 },
  walletCopy: { flex: 1, minWidth: 0 },
  walletLabel: { color: palette.muted, fontFamily: Fonts.mono, fontSize: 8, fontWeight: '700', letterSpacing: 0.7 },
  walletTitle: { color: palette.ink, fontFamily: Fonts.sans, fontSize: 14, fontWeight: '700', marginTop: 3 },
  walletAddress: { color: palette.muted, fontFamily: Fonts.mono, fontSize: 10, marginTop: 4 },
  walletReady: { color: palette.proof, fontFamily: Fonts.sans, fontSize: 10, fontWeight: '700' },
});
