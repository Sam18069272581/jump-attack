import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Card } from '@/components/ui';
import { discardKept, exportBackup, keptBeforeRestore, restoreBackup, undoRestore } from '@/db/backup';
import { LATEST_VERSION } from '@/db/migrations';
import { describeBackup, isPristine, parseBackup, type Backup } from '@/domain/backup';
import { dateTime } from '@/domain/dates';
import { tr } from '@/i18n';
import { pickBackupText, shareBackupFile } from '@/sync/files';
import { useSync } from '@/state/sync';
import { colors, text } from '@/theme';

/** Cloud sign-in and sync, and backup files as the fallback. */
export default function BackupScreen() {
  const db = useSQLiteContext();
  const sync = useSync();
  const [exporting, setExporting] = useState(false);
  const [restoring, setRestoring] = useState(false);
  // What the last restore replaced, kept on the phone (db/backup.ts), and whether it is being put back.
  const [kept, setKept] = useState<{ at: string; backup: Backup } | null>(null);
  const [undoing, setUndoing] = useState(false);

  const loadKept = useCallback(async () => setKept(await keptBeforeRestore(db)), [db]);
  useEffect(() => {
    keptBeforeRestore(db).then(setKept);
  }, [db]);

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
      Alert.alert(tr('没有恢复'), parsed.problem);
      return;
    }
    const current = await exportBackup(db);
    const made = parsed.backup.exported_at.slice(0, 10);
    const what = { backup: describeBackup(parsed.backup), p: made ? tr('（{made}）', { made }) : '', current: describeBackup(current) };
    Alert.alert(
      tr('用这份备份替换手机上的数据？'),
      // A phone that holds nothing yet keeps nothing (see restoreBackup).
      isPristine(current) ? tr('备份里：{backup}{p}\n手机上现在：{current}', what) : tr('备份里：{backup}{p}\n手机上现在：{current}\n\n现在的数据会在手机上留一份，替换后可以在这页换回来。', what),
      [
        { text: tr('取消'), style: 'cancel' },
        {
          text: tr('替换'),
          style: 'destructive',
          onPress: async () => {
            setRestoring(true);
            const r = await sync.replaceData(() => restoreBackup(db, parsed.backup));
            setRestoring(false);
            await loadKept();
            if (!r.ok) {
              Alert.alert(tr('没有恢复'), r.problem);
              return;
            }
            await sync.dataReplaced();
            Alert.alert(tr('已恢复'), sync.email ? tr('下次同步时会把它备份到云端。') : undefined);
          },
        },
      ],
    );
  }

  function undo() {
    if (!kept) return;
    Alert.alert(tr('换回替换前的数据？'), tr('换回 {at} 替换前的数据：{kept}\n手机上现在的数据会留一份，可以再换回来。', { at: dateTime(kept.at), kept: describeBackup(kept.backup) }), [
      { text: tr('取消'), style: 'cancel' },
      {
        text: tr('换回'),
        style: 'destructive',
        onPress: async () => {
          setUndoing(true);
          // What it puts back may be another account's (on a shared phone): the next sync asks before backing it up.
          const r = await sync.replaceData(() => undoRestore(db, kept.at), true);
          setUndoing(false);
          await loadKept();
          if (!r.ok) {
            Alert.alert(tr('没有换回'), r.problem);
            return;
          }
          await sync.dataReplaced();
          Alert.alert(tr('已换回'), sync.email ? (r.asks ? tr('下次同步时会先问你，确认后才备份到云端。') : tr('下次同步时会把它备份到云端。')) : undefined);
        },
      },
    ]);
  }

  function discard() {
    if (!kept) return;
    Alert.alert(tr('删掉留着的数据？'), tr('{at} 替换前的数据：{kept}\n删掉后就不能换回了，只有它用到的录像也会删掉。', { at: dateTime(kept.at), kept: describeBackup(kept.backup) }), [
      { text: tr('取消'), style: 'cancel' },
      {
        text: tr('删除'),
        style: 'destructive',
        onPress: async () => {
          await discardKept(db, kept.at);
          await loadKept();
        },
      },
    ]);
  }

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={text.section}>{tr('云端同步')}</Text>
          <CloudCard />

          <Text style={[text.section, { paddingTop: 8 }]}>{tr('备份文件')}</Text>
          <Card style={{ gap: 10 }}>
            <Text style={text.body}>{tr('把全部数据存成一个文件，可以存到「文件」App、iCloud 云盘，或隔空投送到另一台手机。换手机、云端连不上时用它恢复。')}</Text>
            <Text style={text.caption}>{tr('录像文件不在备份里，只备份测试结果、训练记录、恢复数据和档案。')}</Text>
            <Button label={tr('导出备份文件')} variant="secondary" onPress={exportFile} busy={exporting} />
            <Button label={tr('从备份文件恢复')} variant="ghost" onPress={restoreFile} busy={restoring} />
          </Card>

          {kept && (
            <>
              <Text style={[text.section, { paddingTop: 8 }]}>{tr('撤回恢复')}</Text>
              <Card style={{ gap: 10 }}>
                <Text style={text.body}>{tr('{at} 替换前的数据还留在手机上：{kept}', { at: dateTime(kept.at), kept: describeBackup(kept.backup) })}</Text>
                <Text style={text.caption}>{tr('在 App 里拍的录像也一起留着，换回时还在。不用换回的话，可以删掉这份。')}</Text>
                <Button label={tr('换回替换前的数据')} variant="secondary" onPress={undo} busy={undoing} />
                <Button label={tr('删掉这份')} variant="ghost" onPress={discard} disabled={undoing} />
              </Card>
            </>
          )}
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
        <Text style={text.body}>{tr('云端还没接好：Supabase 项目的地址和 key 填进 src/sync/config.ts 后，这里就能登录。现在可以先用下面的备份文件。')}</Text>
      </Card>
    );
  }

  if (sync.email) {
    return (
      <Card style={{ gap: 10 }}>
        <Text style={text.body}>{tr('已登录 {email}', { email: sync.email })}</Text>
        <Text style={text.caption}>{sync.status ?? tr('打开 App 和切到后台时会自动同步。')}</Text>
        {sync.conflict && (
          <View style={styles.conflict}>
            <Text style={text.section}>{tr('手机和云端的数据不一样，选一份保留')}</Text>
            <Text style={text.caption}>{tr('手机上：{phone}\n云端：{cloud}\n另一份会被替换。云端以前每天的备份都还在。', { phone: sync.conflict.phone, cloud: sync.conflict.cloud })}</Text>
            <View style={styles.row}>
              <Button label={tr('用云端的')} onPress={() => sync.syncNow('cloud')} busy={sync.busy} style={{ flex: 1 }} />
              <Button label={tr('用手机上的')} variant="secondary" onPress={() => sync.syncNow('phone')} busy={sync.busy} style={{ flex: 1 }} />
            </View>
          </View>
        )}
        {sync.confirm && (
          <View style={styles.conflict}>
            <Text style={text.section}>{tr('这台手机上的数据之前同步到另一个账号')}</Text>
            <Text style={text.caption}>{tr('手机上：{phone}\n这个账号在云端还没有备份，确认后才会把这些数据备份过去。', { phone: sync.confirm.phone })}</Text>
            <Button label={tr('备份到这个账号')} onPress={() => sync.syncNow('phone')} busy={sync.busy} />
          </View>
        )}
        <Button label={tr('立即同步')} variant="secondary" onPress={() => sync.syncNow()} busy={sync.busy} />
        <Button label={tr('退出登录')} variant="ghost" onPress={sync.signOut} />
        <Text style={text.caption}>{tr('退出登录不会删除手机上的数据，也不会删除云端的备份。')}</Text>
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
      <Text style={text.body}>{tr('登录后，手机上的全部数据会自动备份到你自己的云端账号。换手机、换电脑启动 Expo Go，或用网页版时，登录同一个邮箱就能恢复。')}</Text>
      <Text style={text.caption}>{tr('备份的内容包括测试、训练、档案和恢复数据（含从苹果健康导入的 HRV、睡眠等），存在你自己的 Supabase 项目里（欧洲服务器），只有你登录后能读。录像文件不上传。')}</Text>
      <TextInput accessibilityLabel={tr('邮箱')} value={email} onChangeText={setEmail} placeholder={tr('邮箱')} placeholderTextColor={colors.textFaint} autoCapitalize="none" autoComplete="email" keyboardType="email-address" style={styles.input} />
      <TextInput accessibilityLabel={tr('密码')} value={password} onChangeText={setPassword} placeholder={tr('密码（至少 6 位）')} placeholderTextColor={colors.textFaint} secureTextEntry autoComplete="password" style={styles.input} />
      {problem && <Text style={styles.problem}>{problem}</Text>}
      <View style={styles.row}>
        <Button label={tr('登录')} onPress={() => submit('in')} busy={busy === 'in'} disabled={!ready || busy != null} style={{ flex: 1 }} />
        <Button label={tr('注册')} variant="secondary" onPress={() => submit('up')} busy={busy === 'up'} disabled={!ready || busy != null} style={{ flex: 1 }} />
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
