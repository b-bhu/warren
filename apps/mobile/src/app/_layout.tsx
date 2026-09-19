import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { TamaguiProvider } from 'tamagui';

import { PrivyRuntimeProvider } from '@/features/privy';
import { tamaguiConfig } from '../../tamagui.config';

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

function AppProviders() {
  const colorScheme = useColorScheme();
  const insets = useSafeAreaInsets();

  useEffect(() => { void SplashScreen.hideAsync(); }, []);

  return (
    <TamaguiProvider
      config={tamaguiConfig}
      defaultTheme={colorScheme === 'light' ? 'light' : 'dark'}
      insets={insets}
    >
      <ThemeProvider value={warrenTheme}>
        <PrivyRuntimeProvider>
          <StatusBar style="light" />
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="stocks/[symbol]" />
            <Stack.Screen name="buy/[symbol]" />
            <Stack.Screen name="sign-in" />
          </Stack>
        </PrivyRuntimeProvider>
      </ThemeProvider>
    </TamaguiProvider>
  );
}

export default function TabLayout() {
  return (
    <SafeAreaProvider>
      <AppProviders />
    </SafeAreaProvider>
  );
}
