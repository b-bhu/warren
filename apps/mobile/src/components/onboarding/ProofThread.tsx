import { StyleSheet, Text, View } from 'react-native';

import { Fonts, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ProofStepState = 'open' | 'waiting' | 'confirmed' | 'checking' | 'error';

export type ProofThreadSteps = {
  domain: ProofStepState;
  wallet: ProofStepState;
  /** The final stop cannot be marked confirmed before Warren verifies the proof. */
  signature: Exclude<ProofStepState, 'confirmed'>;
};

export type ProofThreadProps = {
  steps: ProofThreadSteps;
  /** Set only after Warren has verified the signature and created or restored a session. */
  serverVerified?: boolean;
  walletLabel?: string;
  signatureLabel?: string;
  /** Supply this when a state machine has more useful wording than the default summary. */
  accessibilityLabel?: string;
};

const stepNames = ['Warren domain', 'Wallet address', 'Your signature'] as const;

function visualStateLabel(state: ProofStepState) {
  switch (state) {
    case 'confirmed':
      return 'confirmed';
    case 'waiting':
      return 'waiting for approval';
    case 'checking':
      return 'checking';
    case 'error':
      return 'needs attention';
    default:
      return 'not yet confirmed';
  }
}

function defaultSummary(steps: Record<keyof ProofThreadSteps, ProofStepState>) {
  return `Sign-in record. ${stepNames[0]} ${visualStateLabel(steps.domain)}. ${stepNames[1]} ${visualStateLabel(steps.wallet)}. ${stepNames[2]} ${visualStateLabel(steps.signature)}.`;
}

/** A status record, deliberately not a progress bar. */
export function ProofThread({
  steps,
  serverVerified = false,
  walletLabel = 'Wallet address',
  signatureLabel = 'Your signature',
  accessibilityLabel,
}: ProofThreadProps) {
  const theme = useTheme();
  const visualSteps: Record<keyof ProofThreadSteps, ProofStepState> = serverVerified
    ? { domain: 'confirmed', wallet: 'confirmed', signature: 'confirmed' }
    : steps;
  const rows = [
    { label: 'Warren domain', state: visualSteps.domain },
    { label: walletLabel, state: visualSteps.wallet },
    { label: signatureLabel, state: visualSteps.signature },
  ];

  return (
    <View accessible accessibilityLabel={accessibilityLabel ?? defaultSummary(visualSteps)} style={styles.thread}>
      {rows.map((row, index) => {
        const isFinal = index === rows.length - 1;
        const nextState = !isFinal ? rows[index + 1].state : undefined;
        const markerColor = row.state === 'error' ? theme.caution : row.state === 'confirmed' ? theme.proof : theme.muted;
        const segmentColor = nextState === 'error' ? theme.caution : nextState === 'confirmed' ? theme.proof : theme.outline;
        const segmentSolid = nextState === 'confirmed';

        return (
          <View key={stepNames[index]} style={styles.row}>
            <View style={styles.rail}>
              <View
                accessibilityElementsHidden
                importantForAccessibility="no"
                style={[
                  styles.marker,
                  {
                    backgroundColor: row.state === 'confirmed' ? markerColor : theme.canvas,
                    borderColor: markerColor,
                  },
                ]}>
                {row.state === 'checking' ? <View style={[styles.checkingDot, { backgroundColor: markerColor }]} /> : null}
              </View>
              {!isFinal ? (
                <View
                  accessibilityElementsHidden
                  importantForAccessibility="no"
                  style={[
                    styles.segment,
                    { borderColor: segmentColor },
                    segmentSolid ? styles.solidSegment : styles.dashedSegment,
                  ]}
                />
              ) : null}
            </View>
            <View style={styles.copy}>
              <Text style={[styles.label, { color: theme.ink }]}>{row.label}</Text>
              {row.state !== 'open' ? <Text style={[styles.state, { color: markerColor }]}>{visualStateLabel(row.state)}</Text> : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  thread: {
    gap: Spacing.one,
  },
  row: {
    flexDirection: 'row',
    minWidth: 0,
  },
  rail: {
    alignItems: 'center',
    marginEnd: Spacing.two,
    width: 16,
  },
  marker: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 2,
    height: 16,
    justifyContent: 'center',
    width: 16,
  },
  checkingDot: {
    borderRadius: 3,
    height: 6,
    width: 6,
  },
  segment: {
    borderStartWidth: 2,
    flexGrow: 1,
    marginVertical: Spacing.half,
    minHeight: Spacing.four,
  },
  solidSegment: {
    borderStyle: 'solid',
  },
  dashedSegment: {
    borderStyle: 'dashed',
  },
  copy: {
    flex: 1,
    paddingBottom: Spacing.one,
  },
  label: {
    fontFamily: Fonts.sans,
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 18,
  },
  state: {
    fontFamily: Fonts.sans,
    fontSize: 14,
    lineHeight: 20,
  },
});
