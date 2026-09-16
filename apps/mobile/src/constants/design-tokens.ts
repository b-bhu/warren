/**
 * Warren's platform-agnostic design tokens.
 *
 * Keep this module free of React Native and CSS imports so it can be consumed by
 * both the application runtime and the root Tamagui configuration.
 */
export const Colors = {
  light: {
    text: '#000000',
    background: '#ffffff',
    backgroundElement: '#F0F0F3',
    backgroundSelected: '#E0E1E6',
    textSecondary: '#60646C',
    canvas: '#F3F5F2',
    surface: '#FFFFFF',
    ink: '#17211F',
    muted: '#53625E',
    proof: '#0B5C78',
    caution: '#A63632',
    onProof: '#FFFFFF',
    outline: '#B9C3BF',
    proofWash: '#DDEDF2',
    cautionWash: '#F9E4E1',
    disabledSurface: '#DDE3DF',
    disabledInk: '#43514D',
  },
  dark: {
    text: '#ffffff',
    background: '#000000',
    backgroundElement: '#212225',
    backgroundSelected: '#2E3135',
    textSecondary: '#B0B4BA',
    canvas: '#131918',
    surface: '#1C2523',
    ink: '#F2F5F1',
    muted: '#B8C4BF',
    proof: '#74C7DF',
    caution: '#FFAAA2',
    onProof: '#131918',
    outline: '#51615C',
    proofWash: '#163640',
    cautionWash: '#42201F',
    disabledSurface: '#2B3633',
    disabledInk: '#D5DEDA',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const Radii = {
  none: 0,
  control: 10,
  card: 12,
  pill: 999,
} as const;
