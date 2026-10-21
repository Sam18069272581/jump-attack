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
            <Stack.Screen name="conditioning/index" options={{ title: '体能耐力' }} />
            <Stack.Screen name="conditioning/yoyo" options={{ title: 'Yo-Yo IR1' }} />
            <Stack.Screen name="conditioning/cooper" options={{ title: 'Cooper 12 分钟跑' }} />
            <Stack.Screen name="conditioning/rsa" options={{ title: 'RSA 反复冲刺' }} />
            <Stack.Screen name="conditioning/result" options={{ title: '测试结果', headerBackVisible: false, gestureEnabled: false }} />
            <Stack.Screen name="jumps/index" options={{ title: '跳跃测试' }} />
            <Stack.Screen name="jumps/fvp" options={{ title: '力-速度曲线' }} />
            <Stack.Screen name="jumps/dj" options={{ title: 'DJ 跳深 · 找最佳箱高' }} />
            <Stack.Screen name="speed/index" options={{ title: '速度训练' }} />
            <Stack.Screen name="mobility/index" options={{ title: '灵活度' }} />
            <Stack.Screen name="mobility/[test]" options={{ title: '' }} />
            <Stack.Screen name="recovery/index" options={{ title: '恢复' }} />
            <Stack.Screen name="vbt/index" options={{ title: 'VBT 训练' }} />
            <Stack.Screen name="vbt/[lift]" options={{ title: '' }} />
            <Stack.Screen name="measure/capture" options={{ headerShown: false }} />
            <Stack.Screen name="measure/mark" options={{ title: '逐帧标记' }} />
            <Stack.Screen name="measure/entry" options={{ title: '' }} />
            <Stack.Screen name="measure/result" options={{ title: '测试结果', headerBackVisible: false, gestureEnabled: false }} />
            <Stack.Screen name="history/[metric]" options={{ title: '' }} />
            <Stack.Screen name="plan/index" options={{ title: '训练计划' }} />
            <Stack.Screen name="plan/new" options={{ title: '选择训练计划' }} />
            <Stack.Screen name="workout/[date]" options={{ title: '' }} />
          </Stack>
        </AthleteProvider>
      </SQLiteProvider>
    </ThemeProvider>
  );
}
