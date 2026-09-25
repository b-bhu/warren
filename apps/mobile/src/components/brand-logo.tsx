import { Image } from 'expo-image';

import { useColorScheme } from '@/hooks/use-color-scheme';

const logos = {
  dark: require('@/assets/brand/approved/brand/brand-dark.png'),
  light: require('@/assets/brand/approved/brand/brand-light.png'),
};

/** The approved lockup, with its original proportions and outlined wordmark. */
export function BrandLogo({
  appearance,
  decorative = false,
  width = 126,
}: {
  /** Use an explicit appearance only on a surface with a fixed palette. */
  appearance?: 'light' | 'dark';
  decorative?: boolean;
  width?: number;
}) {
  const scheme = useColorScheme();
  const theme = appearance ?? (scheme === 'dark' ? 'dark' : 'light');

  return (
    <Image
      accessibilityElementsHidden={decorative}
      accessibilityLabel={decorative ? undefined : 'Warren'}
      accessibilityRole="image"
      accessible={!decorative}
      contentFit="contain"
      importantForAccessibility={decorative ? 'no' : 'auto'}
      source={logos[theme]}
      style={{ width, height: (width * 640) / 1960, flexShrink: 0 }}
      transition={0}
    />
  );
}
