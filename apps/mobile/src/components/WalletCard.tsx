import { ActivityIndicator, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import QRCodeStyled from 'react-native-qrcode-styled';

import { Fonts } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** The same verified wallet identity is used throughout onboarding and deposits. */
export function WalletCard({ address, expanded = false, preparing = false }: {
  address: string | null;
  expanded?: boolean;
  preparing?: boolean;
}) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const waiting = preparing || !address;
  const gain = theme.canvas === '#131918' ? '#8BC4A1' : '#286440';
  const qrSize = width < 360 ? 148 : 168;

  return (
    <View accessibilityLabel="Warren Solana wallet" style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.outline, padding: width < 360 ? 17 : 20 }]}>
      <View style={styles.top}>
        <View style={styles.brand}>
          <View style={[styles.mark, { backgroundColor: theme.proofWash }]}><Text style={[styles.markText, { color: theme.proof }]}>W</Text></View>
          <Text style={[styles.brandText, { color: theme.ink }]}>Warren wallet</Text>
        </View>
        <Text style={[styles.network, { borderColor: theme.outline, color: theme.muted }]}>Solana</Text>
      </View>
      {expanded && !waiting ? (
        <View style={styles.receive}>
          <View accessibilityLabel="Wallet address QR code" accessibilityRole="image" style={styles.qr}>
            <QRCodeStyled data={address} color="#131918" padding={20} pieceSize={5} height={qrSize} width={qrSize} />
          </View>
          <View>
            <Text style={[styles.addressLabel, { color: theme.muted }]}>Your Solana wallet address</Text>
            <Text selectable style={[styles.fullAddress, { color: theme.ink }]}>{address}</Text>
          </View>
        </View>
      ) : (
        <>
          <Text style={[styles.address, waiting && styles.preparingAddress, { color: waiting ? theme.muted : theme.ink }]}>
            {waiting ? 'Preparing your wallet…' : `${address.slice(0, 4)}…${address.slice(-4)}`}
          </Text>
          <View style={[styles.footer, { borderTopColor: `${theme.muted}33` }]}>
            <Text style={[styles.footerText, { color: theme.muted }]}>{waiting ? 'Getting your wallet ready' : 'Your wallet for investing'}</Text>
            <View style={styles.state}>
              {waiting ? <ActivityIndicator color={theme.proof} size="small" /> : <View style={[styles.dot, { backgroundColor: gain }]} />}
              <Text style={[styles.stateText, { color: waiting ? theme.proof : gain }]}>{waiting ? 'Preparing' : 'Ready'}</Text>
            </View>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 20, borderWidth: 1, marginTop: 24 },
  top: { alignItems: 'center', flexDirection: 'row', gap: 8, justifyContent: 'space-between' },
  brand: { alignItems: 'center', flexDirection: 'row', flexShrink: 1, gap: 9 },
  mark: { alignItems: 'center', borderRadius: 9, height: 29, justifyContent: 'center', width: 29 },
  markText: { fontFamily: Fonts.serif, fontSize: 17, fontWeight: '600' },
  brandText: { flexShrink: 1, fontFamily: Fonts.sans, fontSize: 13, fontWeight: '500' },
  network: { borderRadius: 6, borderWidth: 1, fontFamily: Fonts.sans, fontSize: 10, paddingHorizontal: 8, paddingVertical: 5 },
  address: { fontFamily: Fonts.mono, fontSize: 22, letterSpacing: -0.5, lineHeight: 29, marginTop: 26 },
  preparingAddress: { fontFamily: Fonts.sans, fontSize: 17, lineHeight: 27 },
  footer: { alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'space-between', marginTop: 22, paddingTop: 13 },
  footerText: { fontFamily: Fonts.sans, fontSize: 10 },
  state: { alignItems: 'center', flexDirection: 'row', gap: 6 },
  stateText: { fontFamily: Fonts.sans, fontSize: 11 },
  dot: { borderRadius: 3, height: 5, width: 5 },
  receive: { gap: 17, marginTop: 20 },
  qr: { alignSelf: 'center', backgroundColor: '#FFFFFF', borderRadius: 12, overflow: 'hidden' },
  addressLabel: { fontFamily: Fonts.sans, fontSize: 10 },
  fullAddress: { fontFamily: Fonts.mono, fontSize: 12, lineHeight: 19, marginTop: 7 },
});
