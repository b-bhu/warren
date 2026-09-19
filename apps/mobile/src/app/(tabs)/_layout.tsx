import { Tabs } from 'expo-router';
import Svg, { Circle, Path } from 'react-native-svg';

import { Fonts } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type TabIconName = 'home' | 'markets' | 'profile';

export default function MainTabLayout() {
  const theme = useTheme();

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
          fontWeight: '700',
          marginTop: 2,
        },
        tabBarStyle: {
          backgroundColor: theme.surface,
          borderTopColor: theme.outline,
          borderTopWidth: 1,
          elevation: 0,
          paddingTop: 7,
          shadowOpacity: 0,
        },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon color={color as string} focused={focused} name="home" />
          ),
        }}
      />
      <Tabs.Screen
        name="markets"
        options={{
          title: 'Markets',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon color={color as string} focused={focused} name="markets" />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon color={color as string} focused={focused} name="profile" />
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
      {name === 'profile' ? (
        <>
          <Circle cx="12" cy="8" r="3.5" stroke={color} strokeWidth={strokeWidth} />
          <Path
            d="M5.5 20c.5-3.8 2.7-5.7 6.5-5.7s6 1.9 6.5 5.7"
            stroke={color}
            strokeLinecap="round"
            strokeWidth={strokeWidth}
          />
        </>
      ) : null}
    </Svg>
  );
}
