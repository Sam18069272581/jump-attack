import { BarlowCondensed_600SemiBold } from '@expo-google-fonts/barlow-condensed/600SemiBold';
import { BarlowCondensed_700Bold } from '@expo-google-fonts/barlow-condensed/700Bold';
import { useFonts } from 'expo-font';
import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import { SQLiteProvider } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';

import { migrate } from '@/db/migrations';
import { AthleteProvider } from '@/state/athlete';
import { colors } from '@/theme';

const theme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: colors.bg, card: colors.bg, text: colors.text, border: colors.divider, primary: colors.accent },
};

export default function RootLayout() {
  const [fontsLoaded] = useFonts({ BarlowCondensed_600SemiBold, BarlowCondensed_700Bold });
  if (!fontsLoaded) return null;

  return (
    <ThemeProvider value={theme}>
      <SQLiteProvider databaseName="jump-attack.db" onInit={migrate}>
        <AthleteProvider>
          <StatusBar style="light" />
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: colors.bg },
              headerTintColor: colors.text,
              headerShadowVisible: false,
              headerBackButtonDisplayMode: 'minimal',
              contentStyle: { backgroundColor: colors.bg },
            }}
          >
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="jumps/index" options={{ title: '跳跃测试' }} />
            <Stack.Screen name="jumps/capture" options={{ headerShown: false }} />
            <Stack.Screen name="jumps/mark" options={{ title: '逐帧标记' }} />
            <Stack.Screen name="jumps/result" options={{ title: '测试结果', headerBackVisible: false, gestureEnabled: false }} />
            <Stack.Screen name="history/[metric]" options={{ title: '' }} />
          </Stack>
        </AthleteProvider>
      </SQLiteProvider>
    </ThemeProvider>
  );
}
