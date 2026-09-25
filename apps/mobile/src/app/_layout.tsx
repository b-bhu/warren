import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useCallback, useEffect } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { TamaguiProvider } from 'tamagui';

import { Colors } from '@/constants/theme';
import {
  PrivyAuthSheetProvider,
  PrivyRuntimeProvider,
  TransactionWalletProvider,
  ViewerStatusProvider,
} from '@/features/privy';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { tamaguiConfig } from '../../tamagui.config';

void SplashScreen.preventAutoHideAsync();

function AppProviders() {
  const colorScheme = useColorScheme();
  const appearance = colorScheme === 'dark' ? 'dark' : 'light';
  const colors = Colors[appearance];
  const baseTheme = appearance === 'dark' ? DarkTheme : DefaultTheme;
  const warrenTheme = {
    ...baseTheme,
    colors: {
      ...baseTheme.colors,
      background: colors.canvas,
      card: colors.surface,
      primary: colors.proof,
      text: colors.ink,
      border: colors.outline,
      notification: colors.caution,
    },
  };
  const insets = useSafeAreaInsets();

  useEffect(() => { void SystemUI.setBackgroundColorAsync(colors.canvas); }, [colors.canvas]);
  const onLayout = useCallback(() => { void SplashScreen.hideAsync(); }, []);

  return (
    <TamaguiProvider
      config={tamaguiConfig}
      defaultTheme={appearance}
      insets={insets}
    >
      <View onLayout={onLayout} style={{ flex: 1, backgroundColor: colors.canvas }}>
        <ThemeProvider value={warrenTheme}>
          <PrivyRuntimeProvider>
            <TransactionWalletProvider>
              <ViewerStatusProvider>
                <PrivyAuthSheetProvider>
                  <StatusBar style={appearance === 'dark' ? 'light' : 'dark'} />
                  <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.canvas } }}>
                    <Stack.Screen name="(tabs)" />
                    <Stack.Screen name="stocks/[assetId]" />
                    <Stack.Screen name="trade/[assetId]" />
                    <Stack.Screen name="lending/[assetId]" />
                    <Stack.Screen name="buy/[symbol]" />
                    <Stack.Screen name="sign-in" />
                  </Stack>
                </PrivyAuthSheetProvider>
              </ViewerStatusProvider>
            </TransactionWalletProvider>
          </PrivyRuntimeProvider>
        </ThemeProvider>
      </View>
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
