import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, text } from '@/theme';

import { Button } from './ui';

/**
 * Shown by the root layout's error boundary, e.g. when the database can't be opened or migrated, so a failure reads
 * as a message rather than a blank screen. A migration runs in a transaction, so a failed one leaves the data as it was.
 */
export function ErrorScreen({ error, retry }: { error: Error; retry: () => Promise<void> }) {
  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.body}>
        <Text style={text.heading}>出错了</Text>
        <Text style={text.body}>App 没能打开。记录都还在手机上，可以先重试；还不行的话，把下面这行发给开发者。</Text>
        <Text selectable style={styles.message}>
          {error.message}
        </Text>
        <Button label="重试" onPress={retry} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  body: { padding: 24, gap: 16 },
  message: { color: colors.textMuted, fontSize: 13, fontFamily: 'Menlo' },
});
