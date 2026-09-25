import { useEffect, useRef } from 'react';
import { AccessibilityInfo, AppState, StyleSheet, Text, View } from 'react-native';
import * as Linking from 'expo-linking';

import {
  ActionDock,
  ChainChoiceCard,
  DetailsDisclosure,
  InlineNotice,
  OnboardingScaffold,
  ProofThread,
  RegisterHeader,
  SignaturePreview,
  StatusPanel,
  WalletEvidenceCard,
} from '@/components/onboarding';
import { Fonts, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import type { OnboardingController } from './use-onboarding-controller';
import { chainLabel, type ChainFamily, type OnboardingState, type SafeBlockedError, type SafeError } from './types';

export type OnboardingFlowProps = {
  controller: OnboardingController;
  /** Called only after the user explicitly opens Details and taps Copy. */
  onCopyAddress?: (address: string) => void;
  /** A future narrow auth-return route can disable this and call controller.reconcile itself. */
  observeExternalReturns?: boolean;
  availableFamilies?: ChainFamily[];
  onContinue?: () => void;
  /** Clearly marks a deterministic local/test adapter; never enable this in release builds. */
  developmentOnly?: boolean;
  testID?: string;
};

/** Provider-neutral presentation layer. Completion is rendered only from a server-verified session result. */
export function OnboardingFlow({ controller, onCopyAddress, observeExternalReturns = true, availableFamilies, onContinue, developmentOnly = false, testID }: OnboardingFlowProps) {
  const { state } = controller;
  const lastHandledUrl = useRef<string | null>(null);
  const announcedState = useRef<string | null>(null);
  const linkingUrl = Linking.useLinkingURL();

  useEffect(() => {
    if (!observeExternalReturns || !linkingUrl || linkingUrl === lastHandledUrl.current || state.status !== 'connecting') return;
    lastHandledUrl.current = linkingUrl;
    const parsed = Linking.parse(linkingUrl);
    const returnCode = firstQueryValue(parsed.queryParams?.code);
    const returnState = firstQueryValue(parsed.queryParams?.state);
    // The API validates host/path/state/one-time code. A link never marks this flow complete locally.
    if (returnCode || returnState) void controller.reconcile({ returnCode, returnState });
  }, [controller, linkingUrl, observeExternalReturns, state.status]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active') return;
      if (state.status === 'connecting') void controller.reconcile();
      if (state.status === 'awaiting_signature' || state.status === 'verifying') void controller.reconcileSignature();
    });
    return () => subscription.remove();
  }, [controller, state.status]);

  useEffect(() => {
    const announcement = announcementFor(state);
    const key = `${state.status}:${announcement}`;
    if (!announcement || announcedState.current === key) return;
    announcedState.current = key;
    const announceWithPriority = AccessibilityInfo.announceForAccessibilityWithOptions;
    if (typeof announceWithPriority === 'function') {
      announceWithPriority(announcement, {
        priority: state.status === 'blocked' || (state.status === 'recoverable_error' && state.error.category === 'verification_failed') ? 'high' : 'low',
      });
    } else {
      // React Native Web does not implement the priority-aware native API.
      AccessibilityInfo.announceForAccessibility(announcement);
    }
  }, [state]);

  return <OnboardingFlowView controller={controller} onCopyAddress={onCopyAddress} availableFamilies={availableFamilies} onContinue={onContinue} developmentOnly={developmentOnly} testID={testID} />;
}

export function OnboardingFlowView({ controller, onCopyAddress, availableFamilies, onContinue, developmentOnly = false, testID }: Omit<OnboardingFlowProps, 'observeExternalReturns'>) {
  const theme = useTheme();
  const { state } = controller;
  const copyWallet = 'wallet' in state ? state.wallet : state.status === 'complete' ? state.session.wallet : undefined;
  const copyError = state.status === 'recoverable_error' || state.status === 'blocked' ? state.error : undefined;

  return (
    <OnboardingScaffold
      testID={testID}
      contentStyle={styles.content}
      actionDock={<Dock controller={controller} onContinue={onContinue} />}>
      <RegisterHeader {...headerFor(state, controller)} />
      {developmentOnly ? <InlineNotice variant="information">Development-only deterministic wallet flow. It cannot sign in to a production Warren environment.</InlineNotice> : null}
      <Body controller={controller} onCopyAddress={onCopyAddress} availableFamilies={availableFamilies} />
      {copyWallet || copyError ? (
        <DetailsDisclosure
          attemptReference={copyError?.attemptReference ?? ('attempt' in state ? state.attempt?.attemptId : undefined)}
          errorCategory={copyError?.diagnosticCategory}
          fullAddress={copyWallet?.address}
          network={copyWallet?.context}
          onCopyAddress={onCopyAddress}
        />
      ) : null}
      {state.status === 'complete' ? <Text style={[styles.quietNote, { color: theme.muted }]}>Add another wallet later from your profile.</Text> : null}
    </OnboardingScaffold>
  );
}

function Body({ controller, onCopyAddress, availableFamilies }: { controller: OnboardingController; onCopyAddress?: (address: string) => void; availableFamilies?: ChainFamily[] }) {
  const { state } = controller;
  const theme = useTheme();

  switch (state.status) {
    case 'not_started':
      return <View style={styles.section}>
        <Text style={[styles.body, { color: theme.ink }]}>A wallet signs in now and approves future actions later.</Text>
        <ProofThread steps={{ domain: 'confirmed', wallet: 'open', signature: 'open' }} />
        <InlineNotice variant="information">Wallet sign-in never asks for a seed phrase and does not move funds.</InlineNotice>
      </View>;
    case 'choosing_chain':
      return <View style={styles.section}>
        <ProofThread steps={{ domain: 'confirmed', wallet: 'open', signature: 'open' }} />
        <View accessibilityRole="radiogroup" style={styles.choices}>
          <ChainChoiceCard chain="EVM wallet" description="Use an EVM-compatible wallet to sign in." disabled={availableFamilies?.includes('evm') === false} selected={state.selectedFamily === 'evm'} onPress={() => controller.chooseChain('evm')} />
          <ChainChoiceCard chain="Solana wallet" description="Use a Solana wallet to sign in." disabled={availableFamilies?.includes('solana') === false} selected={state.selectedFamily === 'solana'} onPress={() => controller.chooseChain('solana')} />
        </View>
      </View>;
    case 'connecting':
      return <View style={styles.section}>
        <ProofThread steps={{ domain: 'confirmed', wallet: 'waiting', signature: 'open' }} walletLabel="Waiting for wallet" />
        <StatusPanel variant="pending" heading={`Choose a wallet in ${state.attempt.providerId}`} announce={false}>You’ll leave Warren to choose a wallet, then return here. Keep this screen open when you return.</StatusPanel>
        <InlineNotice variant="information">Why am I leaving the app? Your wallet provider owns the connection step. Warren will ask you to review the wallet before signing in.</InlineNotice>
      </View>;
    case 'connected_unverified':
      return <View style={styles.section}>
        <ProofThread steps={{ domain: 'confirmed', wallet: 'confirmed', signature: 'open' }} walletLabel={chainLabel(state.wallet.family)} />
        {state.view === 'connected' ? <>
          <Text style={[styles.body, { color: theme.ink }]}>Wallet connected. Prove it’s yours.</Text>
          <WalletEvidenceCard chain={chainLabel(state.wallet.family)} address={state.wallet.address} shortenedAddress={state.wallet.addressDisplay} network={state.wallet.context} onCopyAddress={onCopyAddress} />
        </> : <>
          <Text style={[styles.body, { color: theme.ink }]}>Review the sign-in before your wallet asks for approval.</Text>
          <SignaturePreview domain={state.challenge.domain} chain={chainLabel(state.wallet.family)} shortenedAddress={state.wallet.addressDisplay} validityWindow={state.challenge.validityWindow} messagePreview={state.challenge.messagePreview} />
        </>}
      </View>;
    case 'awaiting_signature':
      return <View style={styles.section}>
        <ProofThread steps={{ domain: 'confirmed', wallet: 'confirmed', signature: 'waiting' }} walletLabel={chainLabel(state.wallet.family)} signatureLabel="Waiting for your signature" />
        <StatusPanel variant="pending" heading="Approve the sign-in in your wallet." announce={false}>{`The request is waiting for ${state.wallet.addressDisplay} on ${chainLabel(state.wallet.family)}.`}</StatusPanel>
        <Text style={[styles.body, { color: theme.ink }]}>This signature is free. It cannot move funds or approve a trade.</Text>
      </View>;
    case 'verifying':
      return <View style={styles.section}>
        <ProofThread steps={{ domain: 'confirmed', wallet: 'confirmed', signature: 'checking' }} walletLabel={chainLabel(state.wallet.family)} />
        <StatusPanel variant="verifying" heading="Checking your signature with Warren." announce={false}>This may take a moment. Do not submit another signing request.</StatusPanel>
      </View>;
    case 'complete':
      return <View style={styles.section}>
        <ProofThread serverVerified steps={{ domain: 'confirmed', wallet: 'confirmed', signature: 'open' }} walletLabel={chainLabel(state.session.wallet.family)} />
        <StatusPanel variant="verified" heading={state.session.source === 'development_demo' ? 'Development demo complete.' : state.purpose === 'link_wallet' ? 'Wallet added.' : 'Wallet verified.'}>{state.session.source === 'development_demo' ? 'No production authentication has occurred.' : 'Your Warren session is ready.'}</StatusPanel>
        {state.session.source === 'development_demo' ? <InlineNotice variant="information">This deterministic adapter is for development only. It cannot sign in to Warren.</InlineNotice> : null}
        <WalletEvidenceCard chain={chainLabel(state.session.wallet.family)} address={state.session.wallet.address} shortenedAddress={state.session.wallet.addressDisplay} network={state.session.wallet.context} onCopyAddress={onCopyAddress} />
      </View>;
    case 'recoverable_error':
      return <FailureBody error={state.error} blocked={false} wallet={walletForRetry(state.retryState)} />;
    case 'blocked':
      return <FailureBody error={state.error} blocked wallet={state.wallet} />;
    default:
      return assertNever(state);
  }
}

function FailureBody({ error, blocked, wallet }: { error: SafeError | SafeBlockedError; blocked: boolean; wallet?: OnboardingState extends never ? never : { family: 'evm' | 'solana'; addressDisplay: string } }) {
  const heading = blocked ? 'Cannot verify this wallet.' : errorHeading(error as SafeError);
  const steps = wallet ? { domain: 'confirmed' as const, wallet: 'confirmed' as const, signature: 'error' as const } : { domain: 'confirmed' as const, wallet: 'error' as const, signature: 'open' as const };
  return <View style={styles.section}>
    <ProofThread steps={steps} walletLabel={wallet ? chainLabel(wallet.family) : 'Cannot verify this wallet'} />
    <StatusPanel variant={blocked ? 'blocked' : 'error'} heading={heading}>{error.message}</StatusPanel>
  </View>;
}

function Dock({ controller, onContinue }: { controller: OnboardingController; onContinue?: () => void }) {
  const { state } = controller;
  switch (state.status) {
    case 'not_started': return <ActionDock primaryLabel="Get started" onPrimaryPress={controller.start} />;
    case 'choosing_chain': return <ActionDock primaryLabel="Continue" onPrimaryPress={() => void controller.continueWithChain()} primaryDisabled={!state.selectedFamily} secondaryLabel="Back" onSecondaryPress={controller.back} />;
    case 'connecting': return <ActionDock primaryLabel={state.attempt.authorizationUrl ? `Open ${state.attempt.providerId}` : 'Resume connection'} onPrimaryPress={() => void (state.attempt.authorizationUrl ? controller.openProvider() : controller.reconcile())} secondaryLabel="Cancel" onSecondaryPress={controller.cancel} />;
    case 'connected_unverified': return state.view === 'connected'
      ? <ActionDock primaryLabel="Review signature" onPrimaryPress={controller.reviewSignature} secondaryLabel="Change wallet" onSecondaryPress={controller.changeWallet} />
      : <ActionDock primaryLabel="Sign in with wallet" onPrimaryPress={() => void controller.requestSignature()} secondaryLabel="Back" onSecondaryPress={controller.back} />;
    case 'awaiting_signature': return state.attempt.signatureHandoffUrl
      ? <ActionDock primaryLabel="Open approval" onPrimaryPress={() => void controller.openApproval()} secondaryLabel="Cancel" onSecondaryPress={controller.cancel} />
      : <ActionDock primaryLabel="Check verification" onPrimaryPress={() => void controller.reconcileSignature()} secondaryLabel="Cancel" onSecondaryPress={controller.cancel} />;
    case 'verifying': return <ActionDock primaryLabel="Checking verification" onPrimaryPress={() => undefined} primaryBusy />;
    case 'complete': return <ActionDock primaryLabel="Continue" onPrimaryPress={onContinue ?? (() => undefined)} />;
    case 'recoverable_error': return <ActionDock primaryLabel={requiresNewAttempt(state.error.category) ? 'Choose wallet again' : 'Try again'} onPrimaryPress={() => void controller.retry()} secondaryLabel="Change wallet" onSecondaryPress={controller.changeWallet} />;
    case 'blocked': return <ActionDock primaryLabel="Choose another wallet" onPrimaryPress={controller.changeWallet} />;
    default: return assertNever(state);
  }
}

function requiresNewAttempt(category: SafeError['category']): boolean {
  return category === 'signature_rejected' || category === 'request_expired' || category === 'verification_failed';
}

function headerFor(state: OnboardingState, controller: OnboardingController) {
  switch (state.status) {
    case 'not_started': return { title: 'Investing starts with ownership.' };
    case 'choosing_chain': return { title: 'Which wallet do you use?', onBack: controller.back };
    case 'connecting': return { title: 'Choose your wallet', status: 'Waiting for wallet approval', onBack: controller.cancel, backLabel: 'Cancel' };
    case 'connected_unverified': return { title: state.view === 'pre_sign' ? 'Review your sign-in.' : 'Wallet connected. Prove it’s yours.', onBack: state.view === 'pre_sign' ? controller.back : undefined };
    case 'awaiting_signature': return { title: 'Approve the sign-in in your wallet.', status: 'Waiting for approval', onBack: controller.cancel, backLabel: 'Cancel' };
    case 'verifying': return { title: 'Checking your signature with Warren.', status: 'Checking verification' };
    case 'complete': return { title: state.session.source === 'development_demo' ? 'Development demo complete.' : state.purpose === 'link_wallet' ? 'Wallet added.' : 'Wallet verified.' };
    case 'recoverable_error': return { title: errorHeading(state.error), status: 'A safe recovery action is available.', onBack: controller.changeWallet, backLabel: 'Choose wallet' };
    case 'blocked': return { title: 'Cannot verify this wallet.', status: 'Choose another wallet to continue.', onBack: controller.changeWallet, backLabel: 'Choose wallet' };
    default: return assertNever(state);
  }
}

function walletForRetry(state: Exclude<OnboardingState, { status: 'recoverable_error' | 'blocked' | 'complete' | 'not_started' }>) {
  return state.status === 'connected_unverified' || state.status === 'awaiting_signature' || state.status === 'verifying' ? state.wallet : undefined;
}

function errorHeading(error: SafeError): string {
  switch (error.category) {
    case 'signature_rejected': return 'Signature not approved.';
    case 'request_expired': return 'The signing request expired.';
    case 'offline': return 'You are offline.';
    case 'provider_unavailable': return 'Wallet provider needs attention.';
    case 'rate_limited': return 'Too many requests.';
    case 'session_invalid': return 'Your session ended.';
    case 'wrong_network': return 'This network is not supported.';
    case 'address_mismatch': return 'The wallet did not match.';
    case 'verification_failed': return 'Signature could not be verified.';
    case 'callback_invalid': return 'This return could not be verified.';
    case 'unknown': return 'Verification was interrupted.';
    default: return assertNever(error.category);
  }
}

function announcementFor(state: OnboardingState): string | null {
  switch (state.status) {
    case 'not_started': return null;
    case 'choosing_chain': return 'Choose an EVM wallet or a Solana wallet.';
    case 'connecting': return 'Waiting for wallet approval.';
    case 'connected_unverified': return state.view === 'pre_sign' ? 'Review your sign-in.' : 'Wallet connected. Ownership is not verified yet.';
    case 'awaiting_signature': return 'Approve the sign-in in your wallet.';
    case 'verifying': return 'Checking your signature with Warren.';
    case 'complete': return state.session.source === 'development_demo' ? 'Development demo complete. No production authentication has occurred.' : 'Wallet verified. Your Warren session is ready.';
    case 'recoverable_error': return `${errorHeading(state.error)} ${state.error.message}`;
    case 'blocked': return `Cannot verify this wallet. ${state.error.message}`;
    default: return assertNever(state);
  }
}

function firstQueryValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled onboarding view state: ${JSON.stringify(value)}`);
}

const styles = StyleSheet.create({
  content: { gap: Spacing.four, paddingBottom: Spacing.four },
  section: { gap: Spacing.three },
  choices: { gap: Spacing.two },
  body: { fontFamily: Fonts.sans, fontSize: 16, lineHeight: 24 },
  quietNote: { fontFamily: Fonts.sans, fontSize: 14, lineHeight: 20 },
});
