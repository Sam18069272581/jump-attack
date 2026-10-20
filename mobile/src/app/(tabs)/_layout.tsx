import { Tabs } from 'expo-router/tabs';

import { Icon } from '@/components/Icon';
import { colors } from '@/theme';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: { backgroundColor: colors.tabBar, borderTopColor: colors.divider },
        tabBarLabelStyle: { fontSize: 11 },
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: '首页', tabBarIcon: ({ color }) => <Icon name="home" color={color} /> }} />
      <Tabs.Screen name="train" options={{ title: '训练', tabBarIcon: ({ color }) => <Icon name="plan" color={color} /> }} />
      <Tabs.Screen name="history" options={{ title: '历史', tabBarIcon: ({ color }) => <Icon name="trend" color={color} /> }} />
      <Tabs.Screen name="me" options={{ title: '我的', tabBarIcon: ({ color }) => <Icon name="user" color={color} /> }} />
    </Tabs>
  );
}
