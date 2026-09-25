import type { CompanySummary } from '@warren/home-contract';
import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path, Rect } from 'react-native-svg';

import { AppAccountButton } from '@/components/AppAccountButton';
import { BrandLogo } from '@/components/brand-logo';
import { Fonts, Spacing } from '@/constants/theme';
import { loadWatchlist } from '@/features/home/home-api';
import { useSavedCompanies } from '@/features/market/saved-companies';
import { usePrivyAuthSheet, useTransactionWallet, useViewerStatus } from '@/features/privy';
import { useTheme } from '@/hooks/use-theme';

import { PortfolioOverview } from './PortfolioOverview';
import { PortfolioActivity } from './PortfolioActivity';
import { PortfolioPositions } from './PortfolioPositions';
import {
  accountControlsAvailable,
  accountControlKey,
  parsePortfolioView,
  portfolioAccessState,
  portfolioTabIntent,
  portfolioViews,
  type PortfolioSheetMode,
  type PortfolioView,
} from './portfolio-state';

export function ProfileTabScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ view?: string | string[] }>();
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const horizontalPadding = width < 360 ? 14 : 18;
  const viewerStatus = useViewerStatus();
  const wallet = useTransactionWallet();
  const authSheet = usePrivyAuthSheet();
  const signedIn = viewerStatus === 'signed-in';
  const accessState = portfolioAccessState(viewerStatus, wallet.status);
  const accountReady = signedIn && accountControlsAvailable(wallet.status);
  const { assetIds, error: savedRepositoryError, hydrated } = useSavedCompanies();
  const view = signedIn ? parsePortfolioView(params.view) : 'overview';
  const [infoSheet, setInfoSheet] = useState<'portfolio-info' | 'about' | null>(null);
  const [profileRefreshVersion, setProfileRefreshVersion] = useState(0);
  const [profileRefreshing, setProfileRefreshing] = useState(false);
  const savedKey = assetIds.slice(0, 6).join(',');
  const [savedState, setSavedState] = useState<{
    companies: CompanySummary[];
    error?: string;
    key: string;
  }>({ companies: [], key: '' });
  const savedCompanies = savedState.key === savedKey ? savedState.companies : [];
  const savedError = savedState.key === savedKey ? savedState.error : undefined;
  const savedLoading = !hydrated || Boolean(savedKey && savedState.key !== savedKey);

  useEffect(() => {
    if (!hydrated || assetIds.length === 0) {
      return;
    }
    const controller = new AbortController();
    loadWatchlist(assetIds.slice(0, 6), controller.signal)
      .then((response) => setSavedState({ companies: response.items, key: savedKey }))
      .catch((reason: unknown) => {
        if (reason instanceof Error && reason.name === 'AbortError') return;
        setSavedState({
          companies: [],
          error: 'Saved companies are still on this device, but their latest prices could not be loaded.',
          key: savedKey,
        });
      });
    return () => controller.abort();
  }, [assetIds, hydrated, savedKey]);

  const openAuthSheet = useCallback((returnView: PortfolioView) => {
    authSheet.open({
      onAuthenticated: () => router.setParams({ view: returnView }),
    });
  }, [authSheet, router]);

  const selectView = useCallback((nextView: PortfolioView) => {
    setProfileRefreshing(false);
    const intent = portfolioTabIntent(nextView, signedIn);
    if (intent.kind === 'sign-in') {
      openAuthSheet(intent.returnView);
      return;
    }
    router.setParams({ view: intent.view });
  }, [openAuthSheet, router, signedIn]);
  const refreshProfile = useCallback(() => {
    if (!accountReady || view === 'activity') return;
    setProfileRefreshing(true);
    setProfileRefreshVersion((current) => current + 1);
  }, [accountReady, view]);
  const settleProfileRefresh = useCallback(() => setProfileRefreshing(false), []);

  const privateView = wallet.status === 'ready' ? (
    <PrivateViewBoundary
      getAccessToken={wallet.getAccessToken}
      onOpenCompany={(assetId) => router.push({ pathname: '/stocks/[assetId]', params: { assetId, source: 'portfolio-holding' } } as Href)}
      onOpenPositions={() => selectView('positions')}
      onSignInAgain={() => {
        void wallet.signOut()
          .catch(() => undefined)
          .finally(() => openAuthSheet(view));
      }}
      onRefreshSettled={settleProfileRefresh}
      refreshVersion={profileRefreshVersion}
      signTransaction={wallet.signTransaction}
      view={view}
      walletAddress={wallet.address}
    />
  ) : null;
  const openWalletSetup = () => openAuthSheet(view);

  return (
    <View style={[styles.screen, { backgroundColor: theme.canvas }]}>
      <SafeAreaView edges={['top', 'left', 'right']} style={styles.safeArea}>
        <View style={[styles.header, { paddingHorizontal: horizontalPadding }]}>
          <View style={styles.brand}>
            <BrandLogo />
          </View>
          <PortfolioAccountControl
            key={accountControlKey(wallet.status, wallet.address)}
            accountReady={accountReady}
            address={wallet.address}
            onOpenAuth={() => openAuthSheet(view)}
            onSignOut={async () => {
              setProfileRefreshing(false);
              await wallet.signOut();
              router.setParams({ view: 'overview' });
            }}
          />
        </View>

        <View accessibilityLabel="Portfolio views" accessibilityRole="tablist" style={[styles.tabs, { borderBottomColor: `${theme.muted}33`, paddingHorizontal: horizontalPadding }]}>
          {portfolioViews.map((candidate) => (
            <PortfolioTab
              key={candidate}
              active={view === candidate}
              label={tabLabel(candidate)}
              locked={!signedIn && candidate !== 'overview'}
              onPress={() => selectView(candidate)}
            />
          ))}
        </View>

        {signedIn && wallet.status === 'ready' && view === 'activity' ? privateView : (
          <ScrollView
            alwaysBounceVertical={accountReady}
            contentContainerStyle={[styles.scrollContent, { paddingHorizontal: horizontalPadding }]}
            keyboardShouldPersistTaps="handled"
            refreshControl={accountReady && view !== 'activity' ? (
              <RefreshControl
                colors={[theme.proof]}
                onRefresh={refreshProfile}
                refreshing={profileRefreshing}
                tintColor={theme.proof}
              />
            ) : undefined}
            showsVerticalScrollIndicator={false}>
            {accessState === 'checking-account' ? (
              <AccountChecking />
            ) : accessState === 'guest' ? (
              <GuestOverview
                companies={savedCompanies}
                error={savedError ?? savedRepositoryError}
                loading={!hydrated || savedLoading}
                onAbout={() => setInfoSheet('about')}
                onCompany={(assetId) => router.push({ pathname: '/stocks/[assetId]', params: { assetId, source: 'portfolio-saved' } } as Href)}
                onLearn={() => setInfoSheet('portfolio-info')}
                onSignIn={() => openAuthSheet('overview')}
              />
            ) : accessState === 'preparing-wallet' ? (
              <WalletPreparing />
            ) : accessState === 'wallet-unavailable' ? (
              <WalletUnavailable
                onResolve={openWalletSetup}
                onSignOut={wallet.signOut}
                status={wallet.status === 'ready' || wallet.status === 'loading' ? 'error' : wallet.status}
              />
            ) : privateView}
          </ScrollView>
        )}
      </SafeAreaView>

      <PortfolioSheet
        key={infoSheet ?? 'closed'}
        address={wallet.address}
        mode={infoSheet}
        onClose={() => setInfoSheet(null)}
        onReceive={() => undefined}
        onSignOut={async () => undefined}
      />
    </View>
  );
}

function PortfolioAccountControl({
  accountReady,
  address,
  onOpenAuth,
  onSignOut,
}: {
  accountReady: boolean;
  address: string | null;
  onOpenAuth: () => void;
  onSignOut: () => Promise<void>;
}) {
  const [mode, setMode] = useState<'account' | 'receive' | null>(null);
  return (
    <>
      <AppAccountButton appearance="outlined" onPress={accountReady ? () => setMode('account') : onOpenAuth} />
      <PortfolioSheet
        address={address}
        mode={accountReady ? mode : null}
        onClose={() => setMode(null)}
        onReceive={() => setMode('receive')}
        onSignOut={onSignOut}
      />
    </>
  );
}

function PortfolioTab({
  active,
  label,
  locked,
  onPress,
}: {
  active: boolean;
  label: string;
  locked: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityLabel={locked ? `${label}, sign-in required` : label}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [styles.tab, pressed && styles.pressed]}>
      <View style={styles.tabLabelRow}>
        <Text style={[styles.tabLabel, { color: active ? theme.ink : theme.muted }]}>{label}</Text>
        {locked ? <LockIcon color={theme.muted} /> : null}
      </View>
      <View style={[styles.tabRule, { backgroundColor: active ? theme.proof : 'transparent' }]} />
    </Pressable>
  );
}

function GuestOverview({
  companies,
  error,
  loading,
  onAbout,
  onCompany,
  onLearn,
  onSignIn,
}: {
  companies: CompanySummary[];
  error?: string;
  loading: boolean;
  onAbout: () => void;
  onCompany: (assetId: string) => void;
  onLearn: () => void;
  onSignIn: () => void;
}) {
  const theme = useTheme();
  return (
    <>
      <View style={[styles.guestHero, { backgroundColor: theme.surface }]}>
        <View style={styles.guestHeroHeading}>
          <View style={[styles.privateMark, { backgroundColor: theme.proofWash }]}>
            <LockIcon color={theme.proof} size={20} />
          </View>
          <View style={styles.guestHeroCopy}>
            <Text style={[styles.guestHeroTitle, { color: theme.ink }]}>Your portfolio stays private.</Text>
            <Text style={[styles.guestHeroBody, { color: theme.muted }]}>Keep exploring. Sign in when you want your holdings, positions, and activity here.</Text>
          </View>
        </View>
        <Pressable
          accessibilityHint="Creates or restores your Warren account"
          accessibilityRole="button"
          onPress={onSignIn}
          style={({ pressed }) => [styles.heroButton, { backgroundColor: theme.proof }, pressed && styles.pressed]}>
          <Text style={[styles.heroButtonText, { color: theme.onProof }]}>Sign in</Text>
          <Text accessible={false} style={[styles.heroButtonArrow, { color: theme.onProof }]}>→</Text>
        </Pressable>
      </View>

      <SectionHeading label={companies.length ? `${companies.length} ${companies.length === 1 ? 'company' : 'companies'}` : undefined} title="Saved on this device" />
      {loading ? (
        <View accessibilityLiveRegion="polite" style={styles.centerState}>
          <ActivityIndicator color={theme.proof} size="small" />
          <Text style={[styles.centerStateText, { color: theme.muted }]}>Loading saved companies…</Text>
        </View>
      ) : error ? (
        <InlineNotice message={error} />
      ) : companies.length ? (
        <View style={[styles.register, { borderTopColor: `${theme.muted}33` }]}>
          {companies.map((company) => <SavedCompanyRow key={company.assetId} company={company} onPress={() => onCompany(company.assetId)} />)}
        </View>
      ) : (
        <View style={[styles.emptySaved, { backgroundColor: theme.surface }]}>
          <Text style={[styles.emptySavedTitle, { color: theme.ink }]}>Nothing saved yet</Text>
          <Text style={[styles.emptySavedBody, { color: theme.muted }]}>Save a company from Home or Markets and it will stay available here on this phone.</Text>
        </View>
      )}
      <Text style={[styles.localNote, { color: theme.muted }]}>Saved on this device. Sign in to see your holdings.</Text>

      <View accessibilityLabel="Portfolio information" style={[styles.utilityList, { borderTopColor: `${theme.muted}33` }]}>
        <UtilityRow label="How Portfolio works" onPress={onLearn} />
        <UtilityRow label="About Warren" onPress={onAbout} />
      </View>
    </>
  );
}

function SavedCompanyRow({ company, onPress }: { company: CompanySummary; onPress: () => void }) {
  const theme = useTheme();
  const positive = (company.changePercent ?? 0) >= 0;
  return (
    <Pressable
      accessibilityLabel={`Open ${company.companyName}, ${formatMoney(company.referencePrice)}, ${formatPercent(company.changePercent)}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.companyRow, { borderBottomColor: `${theme.muted}33` }, pressed && styles.rowPressed]}>
      <View style={[styles.companyLogo, { backgroundColor: theme.proofWash }]}>
        {company.logoUrl && !company.logoUrl.toLowerCase().endsWith('.svg') ? (
          <Image contentFit="contain" source={{ uri: company.logoUrl }} style={styles.companyLogoImage} />
        ) : (
          <Text style={[styles.companyInitials, { color: theme.proof }]}>{initials(company.companyName)}</Text>
        )}
      </View>
      <View style={styles.companyCopy}>
        <Text numberOfLines={1} style={[styles.companyName, { color: theme.ink }]}>{company.companyName}</Text>
        <Text numberOfLines={1} style={[styles.companyMeta, { color: theme.muted }]}>{company.ticker} · {company.instrumentHints[0] ?? 'Supported market'}</Text>
      </View>
      <View style={styles.companyValue}>
        <Text style={[styles.companyPrice, { color: theme.ink }]}>{formatMoney(company.referencePrice)}</Text>
        <Text style={[styles.companyChange, { color: company.changePercent === null ? theme.muted : positive ? (theme.canvas === '#131918' ? '#8BC4A1' : '#286440') : theme.caution }]}>
          {formatPercent(company.changePercent)}
        </Text>
      </View>
    </Pressable>
  );
}

function WalletPreparing() {
  const theme = useTheme();
  return (
    <View accessibilityLiveRegion="polite" style={styles.fullState}>
      <ActivityIndicator color={theme.proof} size="small" />
      <Text style={[styles.fullStateTitle, { color: theme.ink }]}>Preparing your Solana wallet</Text>
      <Text style={[styles.fullStateBody, { color: theme.muted }]}>Keep Warren open. Your private portfolio will appear after Privy restores the wallet linked to this account.</Text>
    </View>
  );
}

function AccountChecking() {
  const theme = useTheme();
  return (
    <View accessibilityLiveRegion="polite" style={styles.fullState}>
      <ActivityIndicator color={theme.proof} size="small" />
      <Text style={[styles.fullStateTitle, { color: theme.ink }]}>Restoring your Warren account</Text>
      <Text style={[styles.fullStateBody, { color: theme.muted }]}>Checking the private session stored securely on this device…</Text>
    </View>
  );
}

function WalletUnavailable({
  onResolve,
  onSignOut,
  status,
}: {
  onResolve: () => void;
  onSignOut: () => Promise<void>;
  status: 'guest' | 'recovery-required' | 'error' | 'unsupported';
}) {
  const theme = useTheme();
  const [notice, setNotice] = useState<string>();
  const [signingOut, setSigningOut] = useState(false);
  const recoveryRequired = status === 'recovery-required';
  const copy = recoveryRequired
    ? {
        body: 'This device cannot access the keys for your existing Solana wallet yet. Recover that same wallet before loading private portfolio data.',
        button: 'Continue wallet recovery',
        title: 'Wallet recovery required',
      }
    : {
        body: status === 'unsupported'
          ? 'This build cannot access your Solana wallet. You can sign out safely and continue browsing public markets.'
          : 'Privy could not finish preparing your Solana wallet. Open wallet setup to retry without creating a replacement wallet.',
        button: 'Open wallet setup',
        title: 'Wallet setup needs attention',
      };
  const signOut = async () => {
    setNotice(undefined);
    setSigningOut(true);
    try {
      await onSignOut();
    } catch {
      setNotice('Warren could not sign out. Check your connection and try again.');
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <View accessibilityLiveRegion="polite" style={styles.fullState}>
      <View style={[styles.privateMark, { backgroundColor: theme.cautionWash }]}>
        <LockIcon color={theme.caution} size={20} />
      </View>
      <Text style={[styles.fullStateTitle, { color: theme.ink }]}>{copy.title}</Text>
      <Text style={[styles.fullStateBody, { color: theme.muted }]}>{copy.body}</Text>
      {status !== 'unsupported' ? (
        <Pressable
          accessibilityRole="button"
          disabled={signingOut}
          onPress={onResolve}
          style={({ pressed }) => [styles.walletStateAction, { backgroundColor: theme.proof }, pressed && styles.pressed]}>
          <Text style={[styles.walletStateActionText, { color: theme.onProof }]}>{copy.button}</Text>
        </Pressable>
      ) : null}
      <Pressable
        accessibilityRole="button"
        disabled={signingOut}
        onPress={() => void signOut()}
        style={({ pressed }) => [styles.walletStateSecondaryAction, pressed && styles.pressed]}>
        <Text style={[styles.walletStateSecondaryText, { color: theme.caution }]}>{signingOut ? 'Signing out…' : 'Sign out'}</Text>
      </Pressable>
      {notice ? <Text style={[styles.walletStateNotice, { color: theme.caution }]}>{notice}</Text> : null}
    </View>
  );
}

function PrivateViewBoundary({
  getAccessToken,
  onOpenCompany,
  onOpenPositions,
  onSignInAgain,
  onRefreshSettled,
  refreshVersion,
  signTransaction,
  view,
  walletAddress,
}: {
  getAccessToken: () => Promise<string>;
  onOpenCompany: (assetId: string) => void;
  onOpenPositions: () => void;
  onSignInAgain: () => void;
  onRefreshSettled: () => void;
  refreshVersion: number;
  signTransaction: (unsignedTransaction: string) => Promise<string>;
  view: PortfolioView;
  walletAddress: string | null;
}) {
  const theme = useTheme();
  if (view === 'overview' && walletAddress) {
    return (
      <PortfolioOverview
        key={walletAddress}
        getAccessToken={getAccessToken}
        onOpenCompany={onOpenCompany}
        onOpenPositions={onOpenPositions}
        onSignInAgain={onSignInAgain}
        onRefreshSettled={onRefreshSettled}
        refreshVersion={refreshVersion}
        signTransaction={signTransaction}
        walletAddress={walletAddress}
      />
    );
  }
  if (view === 'positions' && walletAddress) {
    return (
      <PortfolioPositions
        key={walletAddress}
        getAccessToken={getAccessToken}
        onOpenCompany={onOpenCompany}
        onSignInAgain={onSignInAgain}
        onRefreshSettled={onRefreshSettled}
        refreshVersion={refreshVersion}
        signTransaction={signTransaction}
        walletAddress={walletAddress}
      />
    );
  }
  if (view === 'activity' && walletAddress) {
    return (
      <PortfolioActivity
        key={walletAddress}
        getAccessToken={getAccessToken}
        onSignInAgain={onSignInAgain}
        walletAddress={walletAddress}
      />
    );
  }
  return (
    <View accessibilityLiveRegion="polite" style={styles.fullState}>
      <ActivityIndicator color={theme.proof} size="small" />
      <Text style={[styles.fullStateTitle, { color: theme.ink }]}>Loading {tabLabel(view).toLowerCase()}</Text>
      <Text style={[styles.fullStateBody, { color: theme.muted }]}>Warren is preparing your private portfolio data.</Text>
    </View>
  );
}

function PortfolioSheet({
  address,
  mode,
  onClose,
  onReceive,
  onSignOut,
}: {
  address: string | null;
  mode: PortfolioSheetMode | null;
  onClose: () => void;
  onReceive: () => void;
  onSignOut: () => Promise<void>;
}) {
  const theme = useTheme();
  const [notice, setNotice] = useState<string>();
  const [signingOut, setSigningOut] = useState(false);
  const copy = async () => {
    if (!address) return;
    await Clipboard.setStringAsync(address);
    setNotice('Wallet address copied.');
  };
  const signOut = async () => {
    setNotice(undefined);
    setSigningOut(true);
    try {
      await onSignOut();
    } catch {
      setNotice('Warren could not sign out. Check your connection and try again.');
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <Modal animationType="slide" onRequestClose={onClose} statusBarTranslucent transparent visible={mode !== null}>
      <View style={styles.modalLayer}>
        <Pressable accessibilityLabel="Close sheet" accessibilityRole="button" onPress={onClose} style={styles.backdrop} />
        <SafeAreaView edges={['bottom', 'left', 'right']} style={[styles.sheet, { backgroundColor: theme.canvas, borderColor: theme.outline }]}>
          <View style={[styles.sheetHandle, { backgroundColor: theme.outline }]} />
          <View style={styles.sheetHeader}>
            <Text accessibilityRole="header" style={[styles.sheetTitle, { color: theme.ink }]}>{sheetTitle(mode)}</Text>
            <Pressable accessibilityLabel="Close" accessibilityRole="button" onPress={onClose} style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}>
              <Text style={[styles.closeText, { color: theme.muted }]}>×</Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.sheetContent} showsVerticalScrollIndicator={false}>
            {mode === 'account' ? (
              <>
                <Text style={[styles.sheetCopy, { color: theme.muted }]}>Your active wallet is used for balances and transaction approvals.</Text>
                <View style={[styles.walletIdentity, { backgroundColor: theme.surface }]}>
                  <View style={[styles.walletIdentityMark, { backgroundColor: theme.proofWash }]}><Text style={[styles.walletIdentityLetter, { color: theme.proof }]}>W</Text></View>
                  <View style={styles.walletIdentityCopy}>
                    <Text style={[styles.walletIdentityLabel, { color: theme.muted }]}>Active wallet</Text>
                    <Text style={[styles.walletIdentityName, { color: theme.ink }]}>Warren wallet</Text>
                    <Text style={[styles.walletIdentityMeta, { color: theme.muted }]}>Embedded · Solana</Text>
                  </View>
                  <Text style={[styles.readyLabel, { color: theme.proof }]}>● Ready</Text>
                </View>
                <Text selectable style={[styles.address, { backgroundColor: theme.surface, color: theme.muted }]}>{address ?? 'Wallet address is still loading'}</Text>
                <View style={styles.walletActions}>
                  <SheetAction label="Copy" onPress={() => void copy()} />
                  <SheetAction label="Receive" onPress={onReceive} />
                </View>
                <Pressable
                  accessibilityRole="button"
                  disabled={signingOut}
                  onPress={() => void signOut()}
                  style={({ pressed }) => [styles.signOutButton, { borderTopColor: theme.outline }, pressed && styles.pressed]}>
                  <Text style={[styles.signOutText, { color: theme.caution }]}>{signingOut ? 'Signing out…' : 'Sign out'}</Text>
                </Pressable>
              </>
            ) : null}

            {mode === 'receive' ? (
              <>
                <Text style={[styles.sheetCopy, { color: theme.muted }]}>Send supported Solana assets to this wallet. Always verify the network before transferring.</Text>
                <Text selectable style={[styles.receiveAddress, { backgroundColor: theme.surface, color: theme.ink }]}>{address ?? 'Wallet address is still loading'}</Text>
                <SheetAction label="Copy wallet address" onPress={() => void copy()} primary />
              </>
            ) : null}

            {mode === 'portfolio-info' ? (
              <>
                <Text style={[styles.sheetCopy, { color: theme.muted }]}>Portfolio keeps three facts separate: assets you own, perpetual positions you have open, and orders waiting to fill.</Text>
                <View style={[styles.fact, { backgroundColor: theme.surface }]}>
                  <Text style={[styles.factText, { color: theme.ink }]}>Net account equity never counts perpetual notional as owned value. Unpriced holdings remain visible outside the total.</Text>
                </View>
              </>
            ) : null}

            {mode === 'about' ? (
              <>
                <Text style={[styles.sheetCopy, { color: theme.muted }]}>Warren brings supported tokenized stocks, private-company exposure, and equity perpetuals into one Solana-first workspace.</Text>
                <View style={[styles.fact, { backgroundColor: theme.surface }]}><Text style={[styles.factText, { color: theme.ink }]}>Market values are informational until you review an executable trade quote.</Text></View>
              </>
            ) : null}

            {notice ? <Text accessibilityLiveRegion="polite" style={[styles.sheetNotice, { color: theme.proof }]}>{notice}</Text> : null}
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

function SheetAction({ label, onPress, primary = false }: { label: string; onPress: () => void; primary?: boolean }) {
  const theme = useTheme();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.sheetAction, { backgroundColor: primary ? theme.proof : theme.proofWash }, pressed && styles.pressed]}>
      <Text style={[styles.sheetActionText, { color: primary ? theme.onProof : theme.proof }]}>{label}</Text>
    </Pressable>
  );
}

function SectionHeading({ label, title }: { label?: string; title: string }) {
  const theme = useTheme();
  return (
    <View style={styles.sectionHeading}>
      <Text accessibilityRole="header" style={[styles.sectionTitle, { color: theme.ink }]}>{title}</Text>
      {label ? <Text style={[styles.sectionLabel, { color: theme.muted }]}>{label}</Text> : null}
    </View>
  );
}

function UtilityRow({ label, onPress }: { label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.utilityRow, { borderBottomColor: `${theme.muted}33` }, pressed && styles.pressed]}>
      <Text style={[styles.utilityLabel, { color: theme.ink }]}>{label}</Text>
      <Text accessible={false} style={[styles.utilityArrow, { color: theme.muted }]}>›</Text>
    </Pressable>
  );
}

function InlineNotice({ message }: { message: string }) {
  const theme = useTheme();
  return <View style={[styles.notice, { backgroundColor: theme.cautionWash }]}><Text style={[styles.noticeText, { color: theme.caution }]}>{message}</Text></View>;
}

function LockIcon({ color, size = 13 }: { color: string; size?: number }) {
  return (
    <Svg fill="none" height={size} viewBox="0 0 24 24" width={size}>
      <Rect height={10} rx={2} stroke={color} strokeWidth={2} width={14} x={5} y={10} />
      <Path d="M8 10V7a4 4 0 0 1 8 0v3" stroke={color} strokeWidth={2} />
    </Svg>
  );
}

function tabLabel(view: PortfolioView) {
  return view[0]!.toUpperCase() + view.slice(1);
}

function sheetTitle(mode: PortfolioSheetMode | null) {
  if (mode === 'account') return 'Account & wallet';
  if (mode === 'receive') return 'Receive';
  if (mode === 'portfolio-info') return 'How Portfolio works';
  return 'About Warren';
}

function initials(name: string) {
  const parts = name.split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}` : name.slice(0, 2)).toUpperCase();
}

function formatMoney(value: number | null) {
  return value === null ? '—' : `$${value.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
}

function formatPercent(value: number | null) {
  if (value === null) return '—';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  safeArea: { flex: 1 },
  header: { alignItems: 'center', flexDirection: 'row', gap: 12, justifyContent: 'space-between', minHeight: 60, paddingVertical: 8 },
  brand: { alignItems: 'center', flexDirection: 'row', gap: 9, minHeight: 44 },
  tabs: { borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 12, minHeight: 46 },
  tab: { flex: 1, justifyContent: 'flex-end', minHeight: 46 },
  tabLabelRow: { alignItems: 'center', flexDirection: 'row', gap: 4, justifyContent: 'center', minHeight: 44 },
  tabLabel: { fontFamily: Fonts.sans, fontSize: 13, fontWeight: '500' },
  tabRule: { borderRadius: 2, height: 2, width: '100%' },
  scrollContent: { flexGrow: 1, paddingBottom: Spacing.five },
  guestHero: { borderRadius: 18, gap: 12, marginTop: 18, paddingHorizontal: 14, paddingVertical: 18 },
  guestHeroHeading: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  privateMark: { alignItems: 'center', borderRadius: 12, height: 38, justifyContent: 'center', width: 38 },
  guestHeroCopy: { flex: 1, minWidth: 0 },
  guestHeroTitle: { fontFamily: Fonts.sans, fontSize: 16, fontWeight: '500', letterSpacing: -0.4, lineHeight: 20 },
  guestHeroBody: { fontFamily: Fonts.sans, fontSize: 12, lineHeight: 17, marginTop: 4 },
  heroButton: { alignItems: 'center', borderRadius: 12, flexDirection: 'row', gap: 10, justifyContent: 'center', minHeight: 46, paddingHorizontal: 13 },
  heroButtonText: { fontFamily: Fonts.sans, fontSize: 13, fontWeight: '500' },
  heroButtonArrow: { fontFamily: Fonts.sans, fontSize: 16 },
  sectionHeading: { alignItems: 'center', flexDirection: 'row', gap: 8, justifyContent: 'space-between', marginBottom: 9, minHeight: 32, paddingTop: 20 },
  sectionTitle: { flexShrink: 1, fontFamily: Fonts.sans, fontSize: 17, fontWeight: '500', letterSpacing: -0.4 },
  sectionLabel: { fontFamily: Fonts.sans, fontSize: 11 },
  register: { borderTopWidth: StyleSheet.hairlineWidth },
  companyRow: { alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 12, minHeight: 66, paddingVertical: 10 },
  companyLogo: { alignItems: 'center', borderRadius: 10, height: 34, justifyContent: 'center', overflow: 'hidden', width: 34 },
  companyLogoImage: { height: 34, width: 34 },
  companyInitials: { fontFamily: Fonts.sans, fontSize: 12, fontWeight: '500' },
  companyCopy: { flex: 1, minWidth: 0 },
  companyName: { fontFamily: Fonts.sans, fontSize: 14, fontWeight: '500' },
  companyMeta: { fontFamily: Fonts.sans, fontSize: 11, lineHeight: 16, marginTop: 4 },
  companyValue: { alignItems: 'flex-end', maxWidth: 124 },
  companyPrice: { fontFamily: Fonts.mono, fontSize: 13, fontWeight: '500' },
  companyChange: { fontFamily: Fonts.mono, fontSize: 11, marginTop: 5 },
  localNote: { fontFamily: Fonts.sans, fontSize: 11, lineHeight: 17, marginTop: 14 },
  centerState: { alignItems: 'center', flexDirection: 'row', gap: 10, minHeight: 68 },
  centerStateText: { fontFamily: Fonts.sans, fontSize: 12 },
  emptySaved: { borderRadius: 15, padding: 16 },
  emptySavedTitle: { fontFamily: Fonts.sans, fontSize: 14, fontWeight: '500' },
  emptySavedBody: { fontFamily: Fonts.sans, fontSize: 12, lineHeight: 18, marginTop: 5 },
  utilityList: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: 27 },
  utilityRow: { alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', justifyContent: 'space-between', minHeight: 54 },
  utilityLabel: { fontFamily: Fonts.sans, fontSize: 13, fontWeight: '500' },
  utilityArrow: { fontFamily: Fonts.sans, fontSize: 21 },
  notice: { borderRadius: 14, padding: 13 },
  noticeText: { fontFamily: Fonts.sans, fontSize: 12, lineHeight: 18 },
  fullState: { alignItems: 'center', flex: 1, justifyContent: 'center', minHeight: 310, paddingHorizontal: 26 },
  fullStateTitle: { fontFamily: Fonts.sans, fontSize: 18, fontWeight: '700', marginTop: 16, textAlign: 'center' },
  fullStateBody: { fontFamily: Fonts.sans, fontSize: 13, lineHeight: 20, marginTop: 7, textAlign: 'center' },
  walletStateAction: { alignItems: 'center', borderRadius: 14, justifyContent: 'center', marginTop: 22, minHeight: 50, paddingHorizontal: 18 },
  walletStateActionText: { fontFamily: Fonts.sans, fontSize: 13, fontWeight: '800' },
  walletStateSecondaryAction: { alignItems: 'center', justifyContent: 'center', marginTop: 8, minHeight: 46, paddingHorizontal: 18 },
  walletStateSecondaryText: { fontFamily: Fonts.sans, fontSize: 13, fontWeight: '700' },
  walletStateNotice: { fontFamily: Fonts.sans, fontSize: 11, lineHeight: 17, marginTop: 7, textAlign: 'center' },
  modalLayer: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(3,7,6,0.76)' },
  sheet: { borderWidth: 1, borderBottomWidth: 0, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '88%', paddingBottom: 12, paddingHorizontal: 20, paddingTop: 10 },
  sheetHandle: { alignSelf: 'center', borderRadius: 2, height: 4, marginBottom: 14, width: 40 },
  sheetHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  sheetContent: { paddingBottom: 8 },
  sheetTitle: { flexShrink: 1, fontFamily: Fonts.sans, fontSize: 21, fontWeight: '500', letterSpacing: -0.6 },
  closeButton: { alignItems: 'center', borderRadius: 14, height: 44, justifyContent: 'center', width: 44 },
  closeText: { fontFamily: Fonts.sans, fontSize: 25, lineHeight: 27 },
  sheetCopy: { fontFamily: Fonts.sans, fontSize: 13, lineHeight: 20, marginTop: 9 },
  walletIdentity: { alignItems: 'center', borderRadius: 17, flexDirection: 'row', gap: 12, marginTop: 17, padding: 14 },
  walletIdentityMark: { alignItems: 'center', borderRadius: 14, height: 44, justifyContent: 'center', width: 44 },
  walletIdentityLetter: { fontFamily: Fonts.serif, fontSize: 16, fontWeight: '700' },
  walletIdentityCopy: { flex: 1, minWidth: 0 },
  walletIdentityLabel: { fontFamily: Fonts.sans, fontSize: 11 },
  walletIdentityName: { fontFamily: Fonts.sans, fontSize: 14, fontWeight: '700', marginVertical: 3 },
  walletIdentityMeta: { fontFamily: Fonts.sans, fontSize: 11 },
  readyLabel: { fontFamily: Fonts.sans, fontSize: 11, fontWeight: '700' },
  address: { borderRadius: 13, fontFamily: Fonts.mono, fontSize: 12, lineHeight: 18, marginTop: 12, padding: 12 },
  walletActions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  sheetAction: { alignItems: 'center', borderRadius: 12, flex: 1, justifyContent: 'center', minHeight: 46, paddingHorizontal: 14 },
  sheetActionText: { fontFamily: Fonts.sans, fontSize: 13, fontWeight: '500', textAlign: 'center' },
  signOutButton: { alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth, justifyContent: 'center', marginTop: 18, minHeight: 54 },
  signOutText: { fontFamily: Fonts.sans, fontSize: 13, fontWeight: '700' },
  receiveAddress: { borderRadius: 15, fontFamily: Fonts.mono, fontSize: 13, lineHeight: 20, marginBottom: 12, marginTop: 17, padding: 16 },
  fact: { borderRadius: 13, marginTop: 15, padding: 13 },
  factText: { fontFamily: Fonts.sans, fontSize: 12, lineHeight: 18 },
  sheetNotice: { fontFamily: Fonts.sans, fontSize: 12, fontWeight: '700', marginTop: 12, textAlign: 'center' },
  pressed: { opacity: 0.72 },
  rowPressed: { opacity: 0.78, transform: [{ scale: 0.995 }] },
});
