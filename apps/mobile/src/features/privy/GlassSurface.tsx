import type { PropsWithChildren } from 'react';
import { View, type ViewProps } from 'react-native';

export function GlassSurface({ children, ...props }: PropsWithChildren<ViewProps>) {
  return <View {...props}>{children}</View>;
}
