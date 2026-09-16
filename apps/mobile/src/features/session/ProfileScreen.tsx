import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ActionDock, DetailsDisclosure, OnboardingScaffold, RegisterHeader, StatusPanel, WalletEvidenceCard } from '@/components/onboarding';
import { Fonts, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { shortenAddress, type ChainFamily } from '@/features/onboarding';
import type { SessionProfile } from './session-provider';

export function ProfileScreen({ profile, onAddWallet, onRefresh, onSignOut }: { profile: SessionProfile; onAddWallet: (family: ChainFamily) => void; onRefresh: () => void; onSignOut: () => void }) {
  const theme = useTheme();
  const families = new Set(profile.wallets.map((wallet) => wallet.family));
  const missing = (['evm', 'solana'] as const).filter((family) => !families.has(family));

  return <OnboardingScaffold actionDock={<ActionDock primaryLabel="Sign out" onPrimaryPress={onSignOut} secondaryLabel="Refresh profile" onSecondaryPress={onRefresh} />} contentStyle={styles.content}>
    <RegisterHeader label="Warren profile" title="Your verified wallets" />
    <StatusPanel variant="verified" heading="You’re signed in.">Your wallet ownership is recorded with Warren.</StatusPanel>
    <View style={styles.section}>
      {profile.wallets.map((wallet) => <View key={`${wallet.family}:${wallet.addressDisplay}`} style={styles.wallet}>
        <WalletEvidenceCard chain={wallet.family === 'evm' ? 'EVM wallet' : 'Solana wallet'} address={wallet.addressDisplay} shortenedAddress={shortenAddress(wallet.addressDisplay)} network={wallet.context} />
        <DetailsDisclosure fullAddress={wallet.addressDisplay} network={wallet.context} label="Wallet details" />
      </View>)}
    </View>
    {missing.length ? <View style={styles.section}>
      <Text style={[styles.heading, { color: theme.ink }]}>Add another wallet</Text>
      <Text style={[styles.body, { color: theme.muted }]}>Link the other wallet family when you are ready. It requires a new ownership signature.</Text>
      {missing.map((family) => <Pressable key={family} accessibilityLabel={`Add ${family === 'evm' ? 'EVM' : 'Solana'} wallet`} accessibilityRole="button" onPress={() => onAddWallet(family)} style={({ pressed }) => [styles.addWallet, { backgroundColor: theme.surface, borderColor: theme.outline, opacity: pressed ? 0.82 : 1 }]}>
        <Text style={[styles.addTitle, { color: theme.ink }]}>{family === 'evm' ? 'Add EVM wallet' : 'Add Solana wallet'}</Text>
        <Text style={[styles.body, { color: theme.muted }]}>Verify ownership before adding it to this profile.</Text>
      </Pressable>)}
    </View> : <Text style={[styles.body, { color: theme.muted }]}>Both EVM and Solana wallets are verified for this profile.</Text>}
  </OnboardingScaffold>;
}

const styles = StyleSheet.create({
  content: { gap: Spacing.four, paddingBottom: Spacing.four },
  section: { gap: Spacing.two },
  wallet: { gap: Spacing.one },
  heading: { fontFamily: Fonts.serif, fontSize: 22, fontWeight: '700', lineHeight: 28 },
  body: { fontFamily: Fonts.sans, fontSize: 16, lineHeight: 24 },
  addWallet: { borderRadius: 12, borderWidth: 1, gap: Spacing.one, minHeight: 88, padding: Spacing.three },
  addTitle: { fontFamily: Fonts.sans, fontSize: 16, fontWeight: '700', lineHeight: 24 },
});
