import { createSystemFont, defaultConfig } from '@tamagui/config/v5';
import { createTamagui } from 'tamagui';

import { Colors, Radii, Spacing } from './src/constants/design-tokens';

function createWarrenTheme(mode: keyof typeof Colors) {
  const colors = Colors[mode];

  return {
    ...defaultConfig.themes[mode],
    background: colors.canvas,
    backgroundHover: colors.proofWash,
    backgroundPress: colors.proofWash,
    backgroundFocus: colors.surface,
    backgroundStrong: colors.surface,
    color: colors.ink,
    colorHover: colors.ink,
    colorPress: colors.ink,
    colorFocus: colors.ink,
    colorTransparent: 'transparent',
    borderColor: colors.outline,
    borderColorHover: colors.proof,
    borderColorPress: colors.proof,
    borderColorFocus: colors.proof,
    placeholderColor: colors.muted,
    outlineColor: colors.proof,
    shadowColor: colors.ink,
    canvas: colors.canvas,
    surface: colors.surface,
    ink: colors.ink,
    muted: colors.muted,
    proof: colors.proof,
    caution: colors.caution,
    onProof: colors.onProof,
    outline: colors.outline,
    proofWash: colors.proofWash,
    cautionWash: colors.cautionWash,
    disabledSurface: colors.disabledSurface,
    disabledInk: colors.disabledInk,
  } as const;
}

export const tamaguiConfig = createTamagui({
  ...defaultConfig,
  fonts: {
    ...defaultConfig.fonts,
    serif: createSystemFont({ font: { family: 'serif' } }),
    mono: createSystemFont({ font: { family: 'monospace' } }),
  },
  settings: {
    ...defaultConfig.settings,
    // Warren uses readable long-form style props in feature code. Config v5
    // defaults to shorthand-only typing, so opt back into both forms.
    onlyAllowShorthands: false,
  },
  tokens: {
    ...defaultConfig.tokens,
    space: {
      ...defaultConfig.tokens.space,
      ...Spacing,
    },
    radius: {
      ...defaultConfig.tokens.radius,
      ...Radii,
    },
  },
  themes: {
    light: createWarrenTheme('light'),
    dark: createWarrenTheme('dark'),
  },
});

export type WarrenTamaguiConfig = typeof tamaguiConfig;

declare module 'tamagui' {
  interface TamaguiCustomConfig extends WarrenTamaguiConfig {}
}

export default tamaguiConfig;
