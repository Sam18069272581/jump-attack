import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Card } from '@/components/ui';
import { exportBackup, restoreBackup } from '@/db/backup';
import { LATEST_VERSION } from '@/db/migrations';
import { describeBackup, parseBackup } from '@/domain/backup';
import { pickBackupText, shareBackupFile } from '@/sync/files';
import { useSync } from '@/state/sync';
import { colors, text } from '@/theme';

/** Cloud sign-in and sync, and backup files as the fallback. */
export default function BackupScreen() {
  const db = useSQLiteContext();
  const sync = useSync();
  const [exporting, setExporting] = useState(false);
  const [restoring, setRestoring] = useState(false);

  async function exportFile() {
    setExporting(true);
    try {
      await shareBackupFile(await exportBackup(db));
    } finally {
      setExporting(false);
    }
  }

  async function restoreFile() {
    const picked = await pickBackupText();
    if (picked == null) return;
    const parsed = parseBackup(picked, LATEST_VERSION);
    if (!parsed.ok) {
      Alert.alert('没有恢复', parsed.problem);
      return;
    }
    const current = await exportBackup(db);
    const made = parsed.backup.exported_at.slice(0, 10);
    Alert.alert(
      '用这份备份替换手机上的数据？',
      `备份里：${describeBackup(parsed.backup)}${made ? `（${made}）` : ''}\n手机上现在：${describeBackup(current)}\n\n替换后不能撤销，需要的话先导出一份现在的数据。`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '替换',
          style: 'destructive',
          onPress: async () => {
            setRestoring(true);
            const r = await restoreBackup(db, parsed.backup);
            setRestoring(false);
            if (!r.ok) {
              Alert.alert('没有恢复', r.problem);
              return;
            }
            await sync.dataReplaced();
            Alert.alert('已恢复', sync.email ? '下次同步时会把它备份到云端。' : undefined);
          },
        },
      ],
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={text.section}>云端同步</Text>
          <CloudCard />

          <Text style={[text.section, { paddingTop: 8 }]}>备份文件</Text>
          <Card style={{ gap: 10 }}>
            <Text style={text.body}>把全部数据存成一个文件，可以存到「文件」App、iCloud 云盘，或隔空投送到另一台手机。换手机、云端连不上时用它恢复。</Text>
            <Text style={text.caption}>录像文件不在备份里，只备份测试结果、训练记录、恢复数据和档案。</Text>
            <Button label="导出备份文件" variant="secondary" onPress={exportFile} busy={exporting} />
            <Button label="从备份文件恢复" variant="ghost" onPress={restoreFile} busy={restoring} />
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function CloudCard() {
  const sync = useSync();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<'in' | 'up' | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  if (!sync.configured) {
    return (
      <Card style={{ gap: 8 }}>
        <Text style={text.body}>云端还没接好：Supabase 项目的地址和 key 填进 src/sync/config.ts 后，这里就能登录。现在可以先用下面的备份文件。</Text>
      </Card>
    );
  }

  if (sync.email) {
    return (
      <Card style={{ gap: 10 }}>
        <Text style={text.body}>已登录 {sync.email}</Text>
        <Text style={text.caption}>{sync.status ?? '打开 App 和切到后台时会自动同步。'}</Text>
        {sync.conflict && (
          <View style={styles.conflict}>
            <Text style={text.section}>手机和云端的数据不一样，选一份保留</Text>
            <Text style={text.caption}>{`手机上：${sync.conflict.phone}\n云端：${sync.conflict.cloud}\n另一份会被替换。云端以前每天的备份都还在。`}</Text>
            <View style={styles.row}>
              <Button label="用云端的" onPress={() => sync.syncNow('cloud')} busy={sync.busy} style={{ flex: 1 }} />
              <Button label="用手机上的" variant="secondary" onPress={() => sync.syncNow('phone')} busy={sync.busy} style={{ flex: 1 }} />
            </View>
          </View>
        )}
        <Button label="立即同步" variant="secondary" onPress={() => sync.syncNow()} busy={sync.busy} />
        <Button label="退出登录" variant="ghost" onPress={sync.signOut} />
        <Text style={text.caption}>退出登录不会删除手机上的数据，也不会删除云端的备份。</Text>
      </Card>
    );
  }

  async function submit(kind: 'in' | 'up') {
    setBusy(kind);
    setProblem(await (kind === 'in' ? sync.signIn : sync.signUp)(email, password));
    setBusy(null);
  }

  const ready = email.includes('@') && password.length > 0;
  return (
    <Card style={{ gap: 10 }}>
      <Text style={text.body}>登录后，手机上的全部数据会自动备份到你自己的云端账号。换手机、换电脑启动 Expo Go，或用网页版时，登录同一个邮箱就能恢复。</Text>
      <Text style={text.caption}>备份的内容包括测试、训练、档案和恢复数据（含从苹果健康导入的 HRV、睡眠等），存在你自己的 Supabase 项目里（欧洲服务器），只有你登录后能读。录像文件不上传。</Text>
      <TextInput accessibilityLabel="邮箱" value={email} onChangeText={setEmail} placeholder="邮箱" placeholderTextColor={colors.textFaint} autoCapitalize="none" autoComplete="email" keyboardType="email-address" style={styles.input} />
      <TextInput accessibilityLabel="密码" value={password} onChangeText={setPassword} placeholder="密码（至少 6 位）" placeholderTextColor={colors.textFaint} secureTextEntry autoComplete="password" style={styles.input} />
      {problem && <Text style={styles.problem}>{problem}</Text>}
      <View style={styles.row}>
        <Button label="登录" onPress={() => submit('in')} busy={busy === 'in'} disabled={!ready || busy != null} style={{ flex: 1 }} />
        <Button label="注册" variant="secondary" onPress={() => submit('up')} busy={busy === 'up'} disabled={!ready || busy != null} style={{ flex: 1 }} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, gap: 12 },
  input: { height: 48, borderRadius: 12, backgroundColor: colors.surfaceRaised, color: colors.text, paddingHorizontal: 14, fontSize: 15 },
  problem: { color: colors.warn, fontSize: 13 },
  row: { flexDirection: 'row', gap: 10 },
  conflict: { gap: 8, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.warn },
});
