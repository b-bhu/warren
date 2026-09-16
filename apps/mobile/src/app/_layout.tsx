import { DarkTheme, Slot, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { PrivyRuntimeProvider } from '@/features/privy';

SplashScreen.preventAutoHideAsync();

const warrenTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: '#07131A',
    card: '#0B1C24',
    primary: '#A9D8C6',
    text: '#F3F0E8',
  },
};

export default function TabLayout() {
  useEffect(() => { void SplashScreen.hideAsync(); }, []);
  return (
    <ThemeProvider value={warrenTheme}>
      <SafeAreaProvider>
        <PrivyRuntimeProvider>
          <StatusBar style="light" />
          <Slot />
        </PrivyRuntimeProvider>
      </SafeAreaProvider>
    </ThemeProvider>
  );
}
