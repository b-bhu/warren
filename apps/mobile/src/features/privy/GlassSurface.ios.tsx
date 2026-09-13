import { GlassView, isGlassEffectAPIAvailable } from 'expo-glass-effect';
import { useEffect, useState, type PropsWithChildren } from 'react';
import { AccessibilityInfo, View, type ViewProps } from 'react-native';

export function GlassSurface({ children, ...props }: PropsWithChildren<ViewProps>) {
  const [reduceTransparency, setReduceTransparency] = useState(true);

  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceTransparencyEnabled().then((enabled) => {
      if (active) setReduceTransparency(enabled);
    });
    return () => {
      active = false;
    };
  }, []);

  if (!isGlassEffectAPIAvailable() || reduceTransparency) {
    return <View {...props}>{children}</View>;
  }

  return (
    <GlassView
      {...props}
      colorScheme="dark"
      glassEffectStyle="regular"
      tintColor="rgba(154, 201, 218, 0.08)">
      {children}
    </GlassView>
  );
}
