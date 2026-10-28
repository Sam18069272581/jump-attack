import { useFonts } from 'expo-font';
import { DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { SQLiteProvider } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';

import { ErrorScreen } from '@/components/ErrorScreen';
import { KeyboardDoneBar } from '@/components/KeyboardDoneBar';
import { migrate } from '@/db/migrations';
import { AthleteProvider } from '@/state/athlete';
import { SyncProvider } from '@/state/sync';
import { colors, fonts } from '@/theme';
import { setupWeb, webDatabaseBlocked } from '@/web/setup';

setupWeb();

const theme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: colors.bg, card: colors.bg, text: colors.text, border: colors.divider, primary: colors.accent },
};

// Expo Router renders this instead of the layout when it throws, e.g. when the database fails to open or migrate.
export { ErrorScreen as ErrorBoundary };

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    [fonts.numeric]: require('@expo-google-fonts/big-shoulders-display/BigShouldersDisplay_700Bold.ttf'),
    [fonts.numericBold]: require('@expo-google-fonts/big-shoulders-display/BigShouldersDisplay_800ExtraBold.ttf'),
  });
  if (!fontsLoaded) return null;
  if (webDatabaseBlocked()) {
    return (
      <View style={styles.blocked}>
        <Text style={styles.blockedTitle}>正在准备本地数据库…</Text>
        <Text style={styles.blockedText}>如果一直停在这里，请用最新版 Safari 或 Chrome 打开这个网址（微信、QQ 里的内置浏览器不支持）。</Text>
      </View>
    );
  }

  return (
    <ThemeProvider value={theme}>
      <SQLiteProvider databaseName="jump-attack.db" onInit={migrate}>
        {/* SyncProvider remounts everything below after a restore, so every screen reads the new data. */}
        <SyncProvider><AthleteProvider>
          <StatusBar style="dark" />
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
            <Stack.Screen name="dunk" options={{ title: '扣篮诊断' }} />
            <Stack.Screen name="jumps/index" options={{ title: '跳跃测试' }} />
            <Stack.Screen name="jumps/fvp" options={{ title: '力-速度曲线' }} />
            <Stack.Screen name="jumps/dj" options={{ title: 'DJ 跳深 · 找最佳箱高' }} />
            <Stack.Screen name="test-day" options={{ title: '测试日' }} />
            <Stack.Screen name="speed/index" options={{ title: '速度训练' }} />
            <Stack.Screen name="mobility/index" options={{ title: '灵活度' }} />
            <Stack.Screen name="mobility/[test]" options={{ title: '' }} />
            <Stack.Screen name="recovery/index" options={{ title: '恢复' }} />
            <Stack.Screen name="recovery/health" options={{ title: '从苹果健康导入' }} />
            <Stack.Screen name="vbt/index" options={{ title: 'VBT 训练' }} />
            <Stack.Screen name="vbt/[lift]" options={{ title: '' }} />
            <Stack.Screen name="vbt/track" options={{ title: '录像测速' }} />
            <Stack.Screen name="measure/capture" options={{ headerShown: false }} />
            <Stack.Screen name="measure/analyse" options={{ title: '自动分析' }} />
            <Stack.Screen name="measure/replay" options={{ title: '回放' }} />
            <Stack.Screen name="measure/mark" options={{ title: '逐帧标记' }} />
            <Stack.Screen name="measure/entry" options={{ title: '' }} />
            <Stack.Screen name="measure/result" options={{ title: '测试结果', headerBackVisible: false, gestureEnabled: false }} />
            <Stack.Screen name="history/[metric]" options={{ title: '' }} />
            <Stack.Screen name="plan/index" options={{ title: '训练计划' }} />
            <Stack.Screen name="plan/new" options={{ title: '选择训练计划' }} />
            <Stack.Screen name="workout/[date]" options={{ title: '' }} />
            <Stack.Screen name="backup" options={{ title: '数据备份与同步' }} />
          </Stack>
          <KeyboardDoneBar />
        </AthleteProvider></SyncProvider>
      </SQLiteProvider>
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  blocked: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 32, backgroundColor: colors.bg },
  blockedTitle: { color: colors.text, fontSize: 17, fontWeight: '700' },
  blockedText: { color: colors.textMuted, fontSize: 14, lineHeight: 21, textAlign: 'center' },
});
