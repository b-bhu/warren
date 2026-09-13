import { LinearGradient } from 'expo-linear-gradient';
import * as Linking from 'expo-linking';
import { useEffect, useMemo, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Fonts } from '@/constants/theme';

import { GlassSurface } from './GlassSurface';

export type LiquidLedgerMode =
  | 'sign-in'
  | 'preparing'
  | 'ready'
  | 'error'
  | 'recovery-required'
  | 'missing-config'
  | 'web-preview';

type Provider = 'apple' | 'google';

type LiquidLedgerScreenProps = {
  mode: LiquidLedgerMode;
  activeProvider?: Provider | null;
  evmAddress?: string | null;
  message?: string | null;
  onLogin?: (provider: Provider) => void;
  onRetry?: () => void;
  onSignOut?: () => void;
  solanaAddress?: string | null;
};

const palette = {
  harbour: '#07131A',
  depth: '#0B1C24',
  slate: '#122630',
  pearl: '#F3F0E8',
  seaGlass: '#A9D8C6',
  ice: '#9AC9DA',
  gold: '#C8AD82',
} as const;

export function LiquidLedgerScreen({
  mode,
  activeProvider,
  evmAddress,
  message,
  onLogin,
  onRetry,
  onSignOut,
  solanaAddress,
}: LiquidLedgerScreenProps) {
  const copy = useMemo(() => screenCopy(mode), [mode]);
  const isBusy = mode === 'preparing' || Boolean(activeProvider);
  const showSignIn = mode === 'sign-in' || mode === 'web-preview';

  return (
    <LinearGradient
      colors={[palette.harbour, '#091820', '#061117']}
      end={{ x: 0.78, y: 1 }}
      start={{ x: 0.16, y: 0 }}
      style={styles.background}>
      <View pointerEvents="none" style={styles.iceGlow} />
      <View pointerEvents="none" style={styles.seaGlow} />
      <SafeAreaView style={styles.safeArea}>
        <ScrollView
          alwaysBounceVertical={false}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}>
          <View style={styles.shell}>
            <Header status={copy.status} />

            <View style={styles.hero}>
              <WalletLens
                evmAddress={evmAddress}
                mode={mode}
                solanaAddress={solanaAddress}
              />
              <Text style={styles.eyebrow}>{copy.eyebrow}</Text>
              <Text accessibilityRole="header" style={styles.title}>
                {copy.titleBefore}
                <Text style={styles.titleAccent}>{copy.titleAccent}</Text>
              </Text>
              <Text style={styles.intro}>{copy.intro}</Text>
            </View>

            <View style={styles.actions}>
              {mode === 'preparing' ? (
                <View accessibilityLiveRegion="polite" style={styles.progressPanel}>
                  <ActivityIndicator color={palette.seaGlass} size="small" />
                  <View style={styles.progressCopy}>
                    <Text style={styles.progressTitle}>Preparing your account</Text>
                    <Text style={styles.progressBody}>
                      {activeProvider
                        ? `Finishing ${providerName(activeProvider)} sign-in…`
                        : 'Securing your Solana and EVM wallets…'}
                    </Text>
                  </View>
                </View>
              ) : null}

              {showSignIn ? (
                <>
                  <ProviderButton
                    disabled={isBusy}
                    glyph={Platform.OS === 'android' ? 'A' : ''}
                    label={activeProvider === 'apple' ? 'Opening Apple…' : 'Continue with Apple'}
                    onPress={() => onLogin?.('apple')}
                    primary
                  />
                  <ProviderButton
                    disabled={isBusy}
                    glyph="G"
                    label={activeProvider === 'google' ? 'Opening Google…' : 'Continue with Google'}
                    onPress={() => onLogin?.('google')}
                  />
                  <LegalNotice />
                  {mode === 'sign-in' && message ? <Notice>{message}</Notice> : null}
                </>
              ) : null}

              {mode === 'missing-config' ? (
                <Notice>
                  Add EXPO_PUBLIC_PRIVY_APP_ID and EXPO_PUBLIC_PRIVY_CLIENT_ID to your
                  local .env, then restart Expo.
                </Notice>
              ) : null}

              {mode === 'web-preview' ? (
                <Notice message={message ?? undefined}>
                  Social sign-in runs in the Stocklana iOS or Android development build.
                </Notice>
              ) : null}

              {mode === 'error' ? (
                <>
                  <Notice tone="error">{message ?? 'Sign-in could not be completed.'}</Notice>
                  {onRetry ? (
                    <ProviderButton glyph="↻" label="Try again" onPress={onRetry} primary />
                  ) : null}
                  {onSignOut ? (
                    <ProviderButton glyph="×" label="Sign out" onPress={onSignOut} />
                  ) : null}
                </>
              ) : null}

              {mode === 'recovery-required' ? (
                <>
                  <Notice tone="error">
                    {message ?? 'Your existing wallets need recovery on this device.'}
                  </Notice>
                  <ProviderButton glyph="×" label="Sign out" onPress={onSignOut} />
                </>
              ) : null}

              {mode === 'ready' ? (
                <ProviderButton glyph="↗" label="Sign out" onPress={onSignOut} />
              ) : null}

              <View style={styles.assurance}>
                <Text style={styles.assuranceGlyph}>◇</Text>
                <Text style={styles.assuranceText}>
                  Stocklana does not store your wallet keys.
                </Text>
              </View>
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    </LinearGradient>
  );
}

function Header({ status }: { status: string }) {
  return (
    <View style={styles.topbar}>
      <View accessibilityLabel="Stocklana" style={styles.brand}>
        <View accessible={false} style={styles.brandMark}>
          <Text style={styles.brandLetter}>S</Text>
        </View>
        <Text style={styles.brandText}>Stocklana</Text>
      </View>
      <View style={styles.statusPill}>
        <Text style={styles.statusText}>{status}</Text>
      </View>
    </View>
  );
}

function WalletLens({
  evmAddress,
  mode,
  solanaAddress,
}: {
  evmAddress?: string | null;
  mode: LiquidLedgerMode;
  solanaAddress?: string | null;
}) {
  const [pulse] = useState(() => new Animated.Value(1));
  const [reduceMotion, setReduceMotion] = useState(true);

  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (active) setReduceMotion(enabled);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      pulse.setValue(1);
      return;
    }

    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          duration: 3600,
          toValue: 1.014,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          duration: 3600,
          toValue: 1,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [pulse, reduceMotion]);

  return (
    <View
      accessibilityLabel={walletLensAccessibilityLabel(mode, solanaAddress, evmAddress)}
      style={styles.lensField}>
      <View accessible={false} style={styles.orbit}>
        <View style={[styles.orbitDot, styles.orbitDotTop]} />
        <View style={[styles.orbitDot, styles.orbitDotBottom]} />
      </View>
      <Animated.View style={[styles.lensMotion, { transform: [{ scale: pulse }] }]}>
        <GlassSurface style={styles.liquidLens}>
          <View pointerEvents="none" style={styles.lensHighlight} />
          <WalletCard
            accent={palette.seaGlass}
            address={solanaAddress}
            chain="Solana wallet"
            glyph="S"
            mode={mode}
            style={styles.solanaCard}
          />
          <WalletCard
            accent={palette.ice}
            address={evmAddress}
            chain="EVM wallet"
            glyph="E"
            mode={mode}
            style={styles.evmCard}
          />
        </GlassSurface>
      </Animated.View>
      <View accessible={false} style={styles.custodySeal}>
        <Text style={styles.custodyText}>YOURS{`\n`}TO KEEP</Text>
      </View>
    </View>
  );
}

function WalletCard({
  accent,
  address,
  chain,
  glyph,
  mode,
  style,
}: {
  accent: string;
  address?: string | null;
  chain: string;
  glyph: string;
  mode: LiquidLedgerMode;
  style: object;
}) {
  return (
    <View accessible={false} style={[styles.walletCard, style]}>
      <View style={styles.walletLine}>
        <View style={styles.chainLabel}>
          <View style={[styles.chainGlyph, { backgroundColor: accent }]}>
            <Text style={styles.chainGlyphText}>{glyph}</Text>
          </View>
          <Text numberOfLines={1} style={styles.chainText}>{chain}</Text>
        </View>
        <Text style={styles.defaultText}>{walletBadge(mode, address)}</Text>
      </View>
      <Text numberOfLines={1} style={styles.addressText}>
        {walletAddressCopy(mode, address)}
      </Text>
    </View>
  );
}

function ProviderButton({
  disabled,
  glyph,
  label,
  onPress,
  primary = false,
}: {
  disabled?: boolean;
  glyph: string;
  label: string;
  onPress?: () => void;
  primary?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || !onPress}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        primary ? styles.primaryButton : styles.secondaryButton,
        pressed && styles.pressedButton,
        (disabled || !onPress) && styles.disabledButton,
      ]}>
      <Text style={[styles.providerGlyph, primary && styles.primaryButtonText]}>{glyph}</Text>
      <Text style={[styles.buttonText, primary && styles.primaryButtonText]}>{label}</Text>
    </Pressable>
  );
}

function Notice({
  children,
  message,
  tone = 'information',
}: {
  children: React.ReactNode;
  message?: string;
  tone?: 'error' | 'information';
}) {
  return (
    <View
      accessibilityLiveRegion="polite"
      style={[styles.notice, tone === 'error' && styles.errorNotice]}>
      <Text style={[styles.noticeText, tone === 'error' && styles.errorNoticeText]}>
        {message ?? children}
      </Text>
    </View>
  );
}

function LegalNotice() {
  const termsUrl = process.env.EXPO_PUBLIC_TERMS_URL?.trim();
  const privacyUrl = process.env.EXPO_PUBLIC_PRIVACY_URL?.trim();

  if (!termsUrl || !privacyUrl) {
    return (
      <Text style={styles.consent}>
        Development access only. Terms and Privacy links must be configured before
        public sign-in. Two embedded wallets will be created automatically.
      </Text>
    );
  }

  return (
    <Text style={styles.consent}>
      By continuing, you agree to the{' '}
      <Text
        accessibilityRole={termsUrl ? 'link' : undefined}
        onPress={termsUrl ? () => void Linking.openURL(termsUrl) : undefined}
        style={termsUrl ? styles.legalLink : undefined}>
        Terms
      </Text>{' '}
      and acknowledge the{' '}
      <Text
        accessibilityRole={privacyUrl ? 'link' : undefined}
        onPress={privacyUrl ? () => void Linking.openURL(privacyUrl) : undefined}
        style={privacyUrl ? styles.legalLink : undefined}>
        Privacy Notice
      </Text>
      . Two embedded wallets will be created automatically.
    </Text>
  );
}

function screenCopy(mode: LiquidLedgerMode) {
  switch (mode) {
    case 'ready':
      return {
        status: 'Wallets ready',
        eyebrow: 'Your private market account',
        titleBefore: 'One account.\nTwo markets.\n',
        titleAccent: 'Ready.',
        intro: 'Your default Solana and EVM wallets are available in this Privy session.',
      };
    case 'preparing':
      return {
        status: 'Securing',
        eyebrow: 'Creating your private account',
        titleBefore: 'One sign-in.\nTwo wallets.\n',
        titleAccent: 'Almost yours.',
        intro: 'Keep Stocklana open while Privy finishes your account and restores both wallets.',
      };
    case 'missing-config':
      return {
        status: 'Setup needed',
        eyebrow: 'Privy configuration',
        titleBefore: 'Add two IDs.\nRestart Expo.\n',
        titleAccent: 'Then sign in.',
        intro: 'Stocklana is ready for Privy; this local build only needs its public app and client IDs.',
      };
    case 'web-preview':
      return {
        status: 'Web preview',
        eyebrow: 'Your private market account',
        titleBefore: 'One sign-in.\nTwo wallets.\n',
        titleAccent: 'Yours.',
        intro: 'This browser shows the approved experience. Use a native development build for real social sign-in.',
      };
    case 'error':
      return {
        status: 'Needs attention',
        eyebrow: 'Your account is safe',
        titleBefore: 'Nothing moved.\nTry once more.\n',
        titleAccent: 'We’re here.',
        intro: 'The sign-in or wallet setup did not finish. You can retry without creating another account.',
      };
    case 'recovery-required':
      return {
        status: 'Recovery needed',
        eyebrow: 'Your existing account',
        titleBefore: 'Same wallets.\nNew device.\n',
        titleAccent: 'Recover safely.',
        intro: 'Stocklana will not create replacement wallets while your existing wallets need recovery.',
      };
    default:
      return {
        status: 'Private beta',
        eyebrow: 'Your private market account',
        titleBefore: 'One sign-in.\nTwo wallets.\n',
        titleAccent: 'Yours.',
        intro: 'Continue once and Stocklana prepares secure Solana and EVM wallets for you. Both appear automatically inside your account.',
      };
  }
}

function walletBadge(mode: LiquidLedgerMode, address?: string | null) {
  if (mode === 'ready' && address) return 'Default';
  if (mode === 'preparing') return 'Securing';
  if (mode === 'missing-config') return 'Waiting';
  return 'Included';
}

function walletAddressCopy(mode: LiquidLedgerMode, address?: string | null) {
  if (address) return shortenAddress(address);
  if (mode === 'preparing') return 'Creating securely…';
  if (mode === 'missing-config') return 'Available after setup';
  return 'Created after sign-in';
}

function walletLensAccessibilityLabel(
  mode: LiquidLedgerMode,
  solanaAddress?: string | null,
  evmAddress?: string | null,
) {
  if (mode === 'ready' && solanaAddress && evmAddress) {
    return 'Default Solana wallet ready. Default EVM wallet ready.';
  }
  if (mode === 'preparing') return 'Stocklana is preparing default Solana and EVM wallets.';
  if (mode === 'recovery-required') {
    return 'Your existing Solana and EVM wallets require recovery on this device.';
  }
  return 'A default Solana wallet and default EVM wallet are included after sign-in.';
}

function shortenAddress(address: string) {
  if (address.length <= 16) return address;
  return `${address.slice(0, 7)}···${address.slice(-5)}`;
}

function providerName(provider: Provider) {
  return provider === 'apple' ? 'Apple' : 'Google';
}

const styles = StyleSheet.create({
  background: {
    flex: 1,
  },
  iceGlow: {
    backgroundColor: 'rgba(154, 201, 218, 0.08)',
    borderRadius: 240,
    height: 420,
    position: 'absolute',
    right: -230,
    top: -150,
    width: 420,
  },
  seaGlow: {
    backgroundColor: 'rgba(169, 216, 198, 0.055)',
    borderRadius: 260,
    height: 500,
    left: -330,
    position: 'absolute',
    top: '42%',
    width: 500,
  },
  safeArea: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  shell: {
    alignSelf: 'center',
    flex: 1,
    maxWidth: 430,
    paddingBottom: 20,
    paddingHorizontal: 22,
    width: '100%',
  },
  topbar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 48,
  },
  brand: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  brandMark: {
    alignItems: 'center',
    backgroundColor: 'rgba(243, 240, 232, 0.06)',
    borderColor: 'rgba(243, 240, 232, 0.42)',
    borderRadius: 10,
    borderWidth: 1,
    height: 27,
    justifyContent: 'center',
    transform: [{ rotate: '-12deg' }],
    width: 27,
  },
  brandLetter: {
    color: palette.seaGlass,
    fontFamily: Fonts.serif,
    fontSize: 14,
    transform: [{ rotate: '12deg' }],
  },
  brandText: {
    color: palette.pearl,
    fontFamily: Fonts.serif,
    fontSize: 18,
    letterSpacing: 0.15,
  },
  statusPill: {
    borderColor: 'rgba(243, 240, 232, 0.12)',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  statusText: {
    color: 'rgba(243, 240, 232, 0.72)',
    fontFamily: Fonts.mono,
    fontSize: 9,
    letterSpacing: 1.3,
    textTransform: 'uppercase',
  },
  hero: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingBottom: 18,
    paddingTop: 8,
  },
  lensField: {
    height: 268,
    marginHorizontal: -5,
    marginTop: 1,
    position: 'relative',
  },
  orbit: {
    borderColor: 'rgba(243, 240, 232, 0.08)',
    borderRadius: 999,
    borderWidth: 1,
    bottom: 24,
    left: 42,
    position: 'absolute',
    right: 42,
    top: 26,
    transform: [{ rotate: '-9deg' }],
  },
  orbitDot: {
    backgroundColor: palette.gold,
    borderRadius: 2,
    height: 4,
    position: 'absolute',
    shadowColor: palette.gold,
    shadowOpacity: 0.7,
    shadowRadius: 8,
    width: 4,
  },
  orbitDotTop: {
    right: '19%',
    top: '9%',
  },
  orbitDotBottom: {
    bottom: '10%',
    left: '18%',
  },
  lensMotion: {
    alignSelf: 'center',
    height: 226,
    position: 'absolute',
    top: 20,
    width: 258,
  },
  liquidLens: {
    backgroundColor: 'rgba(18, 38, 48, 0.62)',
    borderBottomLeftRadius: 96,
    borderBottomRightRadius: 118,
    borderColor: 'rgba(243, 240, 232, 0.26)',
    borderTopLeftRadius: 118,
    borderTopRightRadius: 101,
    borderWidth: 1,
    flex: 1,
    overflow: 'hidden',
    shadowColor: '#01080C',
    shadowOffset: { height: 28, width: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 35,
  },
  lensHighlight: {
    backgroundColor: 'rgba(255, 255, 255, 0.075)',
    borderRadius: 60,
    height: 84,
    left: 24,
    position: 'absolute',
    top: 10,
    transform: [{ rotate: '-18deg' }],
    width: 96,
  },
  walletCard: {
    backgroundColor: 'rgba(243, 240, 232, 0.10)',
    borderColor: 'rgba(243, 240, 232, 0.17)',
    borderRadius: 17,
    borderWidth: 1,
    left: 36,
    minHeight: 76,
    paddingHorizontal: 14,
    paddingVertical: 12,
    position: 'absolute',
    shadowColor: '#020A0E',
    shadowOffset: { height: 14, width: 0 },
    shadowOpacity: 0.28,
    shadowRadius: 16,
    width: 184,
  },
  solanaCard: {
    top: 36,
    transform: [{ rotate: '-5deg' }],
  },
  evmCard: {
    left: 40,
    top: 126,
    transform: [{ rotate: '4deg' }],
  },
  walletLine: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
  },
  chainLabel: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 1,
    gap: 8,
  },
  chainGlyph: {
    alignItems: 'center',
    borderRadius: 10,
    height: 20,
    justifyContent: 'center',
    width: 20,
  },
  chainGlyphText: {
    color: palette.harbour,
    fontFamily: Fonts.mono,
    fontSize: 8,
    fontWeight: '700',
  },
  chainText: {
    color: palette.pearl,
    flexShrink: 1,
    fontFamily: Fonts.sans,
    fontSize: 12,
    fontWeight: '600',
  },
  defaultText: {
    color: 'rgba(243, 240, 232, 0.68)',
    fontFamily: Fonts.mono,
    fontSize: 8,
    letterSpacing: 0.7,
    textTransform: 'uppercase',
  },
  addressText: {
    color: 'rgba(243, 240, 232, 0.58)',
    fontFamily: Fonts.mono,
    fontSize: 11,
    letterSpacing: 0.35,
    marginTop: 11,
  },
  custodySeal: {
    alignItems: 'center',
    backgroundColor: 'rgba(7, 19, 26, 0.82)',
    borderColor: 'rgba(200, 173, 130, 0.43)',
    borderRadius: 30,
    borderWidth: 1,
    bottom: 8,
    height: 60,
    justifyContent: 'center',
    position: 'absolute',
    right: 24,
    shadowColor: '#01070A',
    shadowOffset: { height: 12, width: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 14,
    transform: [{ rotate: '7deg' }],
    width: 60,
  },
  custodyText: {
    color: palette.gold,
    fontFamily: Fonts.mono,
    fontSize: 8,
    letterSpacing: 0.7,
    lineHeight: 11,
    textAlign: 'center',
  },
  eyebrow: {
    color: palette.seaGlass,
    fontFamily: Fonts.mono,
    fontSize: 9,
    letterSpacing: 1.7,
    marginBottom: 11,
    textTransform: 'uppercase',
  },
  title: {
    color: palette.pearl,
    fontFamily: Fonts.serif,
    fontSize: 46,
    fontWeight: '400',
    letterSpacing: -1.9,
    lineHeight: 43,
  },
  titleAccent: {
    color: palette.seaGlass,
    fontFamily: Fonts.serif,
    fontStyle: 'italic',
    fontWeight: '400',
  },
  intro: {
    color: 'rgba(243, 240, 232, 0.72)',
    fontFamily: Fonts.sans,
    fontSize: 13,
    letterSpacing: 0.05,
    lineHeight: 20,
    marginTop: 17,
    maxWidth: 350,
  },
  actions: {
    gap: 10,
    marginTop: 'auto',
  },
  button: {
    alignItems: 'center',
    borderRadius: 18,
    flexDirection: 'row',
    gap: 10,
    height: 54,
    justifyContent: 'center',
    width: '100%',
  },
  primaryButton: {
    backgroundColor: palette.pearl,
    shadowColor: '#01070A',
    shadowOffset: { height: 13, width: 0 },
    shadowOpacity: 0.28,
    shadowRadius: 18,
  },
  secondaryButton: {
    backgroundColor: 'rgba(243, 240, 232, 0.055)',
    borderColor: 'rgba(243, 240, 232, 0.17)',
    borderWidth: 1,
  },
  pressedButton: {
    opacity: 0.82,
    transform: [{ scale: 0.995 }],
  },
  disabledButton: {
    opacity: 0.48,
  },
  providerGlyph: {
    color: palette.pearl,
    fontFamily: Fonts.sans,
    fontSize: 18,
    fontWeight: '600',
    minWidth: 18,
    textAlign: 'center',
  },
  buttonText: {
    color: palette.pearl,
    fontFamily: Fonts.sans,
    fontSize: 14,
    fontWeight: '600',
  },
  primaryButtonText: {
    color: palette.harbour,
  },
  consent: {
    color: 'rgba(243, 240, 232, 0.52)',
    fontFamily: Fonts.sans,
    fontSize: 11,
    lineHeight: 16,
    marginHorizontal: 14,
    marginTop: 2,
    textAlign: 'center',
  },
  legalLink: {
    color: 'rgba(243, 240, 232, 0.80)',
    textDecorationLine: 'underline',
  },
  assurance: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 7,
    justifyContent: 'center',
    marginTop: 2,
  },
  assuranceGlyph: {
    color: palette.gold,
    fontSize: 12,
    lineHeight: 17,
  },
  assuranceText: {
    color: 'rgba(243, 240, 232, 0.50)',
    fontFamily: Fonts.sans,
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
  },
  progressPanel: {
    alignItems: 'center',
    backgroundColor: 'rgba(169, 216, 198, 0.08)',
    borderColor: 'rgba(169, 216, 198, 0.24)',
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    minHeight: 64,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  progressCopy: {
    flex: 1,
    gap: 2,
  },
  progressTitle: {
    color: palette.pearl,
    fontFamily: Fonts.sans,
    fontSize: 13,
    fontWeight: '600',
  },
  progressBody: {
    color: 'rgba(243, 240, 232, 0.60)',
    fontFamily: Fonts.sans,
    fontSize: 11,
    lineHeight: 16,
  },
  notice: {
    backgroundColor: 'rgba(154, 201, 218, 0.08)',
    borderColor: 'rgba(154, 201, 218, 0.24)',
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  errorNotice: {
    backgroundColor: 'rgba(200, 173, 130, 0.10)',
    borderColor: 'rgba(200, 173, 130, 0.36)',
  },
  noticeText: {
    color: 'rgba(243, 240, 232, 0.74)',
    fontFamily: Fonts.sans,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
  errorNoticeText: {
    color: palette.pearl,
  },
});
