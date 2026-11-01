import { useFonts } from 'expo-font';
import { DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { SQLiteProvider } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';

import { ErrorScreen } from '@/components/ErrorScreen';
import { KeyboardDoneBar } from '@/components/KeyboardDoneBar';
import { migrate } from '@/db/migrations';
import { tr } from '@/i18n';
import { AthleteProvider } from '@/state/athlete';
import { initLanguage, LangProvider } from '@/state/lang';
import { SyncProvider } from '@/state/sync';
import { colors, fonts } from '@/theme';
import { setupWeb, webDatabaseBlocked } from '@/web/setup';

setupWeb();
initLanguage();

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
        <Text style={styles.blockedTitle}>{tr('正在准备本地数据库…')}</Text>
        <Text style={styles.blockedText}>{tr('如果一直停在这里，请用最新版 Safari 或 Chrome 打开这个网址（微信、QQ 里的内置浏览器不支持）。')}</Text>
      </View>
    );
  }

  return (
    <ThemeProvider value={theme}>
      <SQLiteProvider databaseName="jump-attack.db" onInit={migrate}>
        {/* SyncProvider remounts everything below after a restore, so every screen reads the new data. */}
        <SyncProvider><AthleteProvider>
          <LangProvider>
            <RootStack />
          </LangProvider>
        </AthleteProvider></SyncProvider>
      </SQLiteProvider>
    </ThemeProvider>
  );
}

/** The screens, rendered inside LangProvider so a language switch rebuilds their titles too. */
function RootStack() {
  return (
    <>
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
        <Stack.Screen name="conditioning/index" options={{ title: tr('体能耐力') }} />
        <Stack.Screen name="conditioning/yoyo" options={{ title: 'Yo-Yo IR1' }} />
        <Stack.Screen name="conditioning/cooper" options={{ title: tr('Cooper 12 分钟跑') }} />
        <Stack.Screen name="conditioning/rsa" options={{ title: tr('RSA 反复冲刺') }} />
        <Stack.Screen name="conditioning/result" options={{ title: tr('测试结果'), headerBackVisible: false, gestureEnabled: false }} />
        <Stack.Screen name="dunk" options={{ title: tr('扣篮诊断') }} />
        <Stack.Screen name="attempts" options={{ title: tr('扣篮尝试') }} />
        <Stack.Screen name="attempt" options={{ title: tr('这次扣篮') }} />
        <Stack.Screen name="technique/index" options={{ title: tr('起跳技术') }} />
        <Stack.Screen name="technique/camera" options={{ headerShown: false, gestureEnabled: false }} />
        <Stack.Screen name="technique/analyse" options={{ title: tr('起跳分析') }} />
        <Stack.Screen name="jumps/index" options={{ title: tr('跳跃测试') }} />
        <Stack.Screen name="jumps/fvp" options={{ title: tr('力-速度曲线') }} />
        <Stack.Screen name="jumps/dj" options={{ title: tr('DJ 跳深 · 找最佳箱高') }} />
        <Stack.Screen name="test-day" options={{ title: tr('测试日') }} />
        <Stack.Screen name="team" options={{ title: tr('团队') }} />
        <Stack.Screen name="speed/index" options={{ title: tr('速度训练') }} />
        <Stack.Screen name="mobility/index" options={{ title: tr('灵活度') }} />
        <Stack.Screen name="mobility/[test]" options={{ title: '' }} />
        <Stack.Screen name="recovery/index" options={{ title: tr('恢复') }} />
        <Stack.Screen name="recovery/health" options={{ title: tr('从苹果健康导入') }} />
        <Stack.Screen name="vbt/index" options={{ title: tr('VBT 训练') }} />
        <Stack.Screen name="vbt/[lift]" options={{ title: '' }} />
        <Stack.Screen name="vbt/track" options={{ title: tr('录像测速') }} />
        <Stack.Screen name="measure/capture" options={{ headerShown: false }} />
        <Stack.Screen name="measure/camera" options={{ headerShown: false, gestureEnabled: false }} />
        <Stack.Screen name="measure/analyse" options={{ title: tr('自动分析') }} />
        <Stack.Screen name="measure/replay" options={{ title: tr('回放') }} />
        <Stack.Screen name="measure/mark" options={{ title: tr('逐帧标记') }} />
        <Stack.Screen name="measure/entry" options={{ title: '' }} />
        <Stack.Screen name="measure/result" options={{ title: tr('测试结果'), headerBackVisible: false, gestureEnabled: false }} />
        <Stack.Screen name="history/[metric]" options={{ title: '' }} />
        <Stack.Screen name="plan/index" options={{ title: tr('训练计划') }} />
        <Stack.Screen name="plan/new" options={{ title: tr('选择训练计划') }} />
        <Stack.Screen name="workout/[date]" options={{ title: '' }} />
        <Stack.Screen name="exercise/[code]" options={{ title: '' }} />
        <Stack.Screen name="backup" options={{ title: tr('数据备份与同步') }} />
      </Stack>
      <KeyboardDoneBar />
    </>
  );
}

const styles = StyleSheet.create({
  blocked: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 32, backgroundColor: colors.bg },
  blockedTitle: { color: colors.text, fontSize: 17, fontWeight: '700' },
  blockedText: { color: colors.textMuted, fontSize: 14, lineHeight: 21, textAlign: 'center' },
});
