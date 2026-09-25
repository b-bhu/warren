import { Tabs } from 'expo-router';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { Fonts } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type TabIconName = 'home' | 'markets' | 'portfolio';

export default function MainTabLayout() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const bottomInset = Math.max(insets.bottom, 8);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: theme.canvas },
        tabBarActiveTintColor: theme.proof,
        tabBarInactiveTintColor: theme.muted,
        tabBarHideOnKeyboard: true,
        tabBarLabelStyle: {
          fontFamily: Fonts.sans,
          fontSize: 12,
          fontWeight: '600',
          lineHeight: 16,
          marginTop: 2,
        },
        tabBarStyle: {
          backgroundColor: theme.surface,
          borderTopColor: `${theme.muted}33`,
          borderTopWidth: 1,
          elevation: 0,
          height: 64 + bottomInset,
          paddingBottom: bottomInset,
          paddingTop: 7,
          shadowOpacity: 0,
        },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, focused }) => (
            <View style={{ alignItems: 'center', backgroundColor: focused ? theme.proofWash : 'transparent', borderRadius: 999, height: 30, justifyContent: 'center', width: 58 }}>
              <TabIcon color={color as string} focused={focused} name="home" />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="markets"
        options={{
          title: 'Markets',
          tabBarIcon: ({ color, focused }) => (
            <View style={{ alignItems: 'center', backgroundColor: focused ? theme.proofWash : 'transparent', borderRadius: 999, height: 30, justifyContent: 'center', width: 58 }}>
              <TabIcon color={color as string} focused={focused} name="markets" />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Portfolio',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon color={color as string} focused={focused} name="portfolio" />
          ),
        }}
      />
    </Tabs>
  );
}

function TabIcon({ color, focused, name }: { color: string; focused: boolean; name: TabIconName }) {
  const strokeWidth = focused ? 2.2 : 1.8;

  return (
    <Svg fill="none" height={23} viewBox="0 0 24 24" width={23}>
      {name === 'home' ? (
        <Path
          d="M3.5 10.5 12 3.7l8.5 6.8v8.3a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5v-8.3Z"
          stroke={color}
          strokeLinejoin="round"
          strokeWidth={strokeWidth}
        />
      ) : null}
      {name === 'home' ? (
        <Path d="M9 20.3v-5.6h6v5.6" stroke={color} strokeLinejoin="round" strokeWidth={strokeWidth} />
      ) : null}
      {name === 'markets' ? (
        <>
          <Path d="M4 4.5v15h16" stroke={color} strokeLinecap="round" strokeWidth={strokeWidth} />
          <Path
            d="m7 15 4-4 3 2 5-6"
            stroke={color}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={strokeWidth}
          />
        </>
      ) : null}
      {name === 'portfolio' ? (
        <>
          <Path d="M5 4.5h14v15H5z" stroke={color} strokeLinejoin="round" strokeWidth={strokeWidth} />
          <Path d="M8 9h8M8 13h8M8 17h5" stroke={color} strokeLinecap="round" strokeWidth={strokeWidth} />
        </>
      ) : null}
    </Svg>
  );
}
