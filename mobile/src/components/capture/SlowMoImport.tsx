import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CaptureHeader } from '@/components/capture/CaptureHeader';
import type { CaptureProps } from '@/components/capture/types';
import { Button } from '@/components/ui';
import { isWeb } from '@/media/runtime';
import { colors, fonts, radius } from '@/theme';


/** Expo Go and web fallback: film with the system camera's slow-motion mode, then import the clip. */
export default function SlowMoImport({ title, subtitle, guide, onClose, onImport, onManual }: CaptureProps) {
  return (
    <SafeAreaView style={styles.screen}>
      <CaptureHeader title={title} subtitle={subtitle} onClose={onClose} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.lead}>用 iPhone 自带相机的慢动作拍，再导入这里测量。</Text>
        {guide.steps.map((s, i) => (
          <View key={s.title} style={styles.step}>
            <Text style={styles.stepNo}>{i + 1}</Text>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={styles.stepTitle}>{s.title}</Text>
              <Text style={styles.stepText}>{s.text}</Text>
            </View>
          </View>
        ))}
        <Text style={styles.note}>
          {isWeb
            ? '网页版导入后会先播放几帧测出视频帧率；慢动作视频在逐帧页把「拍摄帧率」选成 240。浏览器逐帧定位不如 App 精确，正式测试建议用 Expo Go 版。'
            : '现在是 Expo Go 预览版，App 内直接录 240 fps 需要安装正式开发版。'}
        </Text>
      </ScrollView>
      <View style={styles.footer}>
        <Button label="从相册导入视频" onPress={onImport} />
        {onManual && <Button label="手动输入成绩" variant="secondary" onPress={onManual} />}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, gap: 12 },
  lead: { color: colors.textSoft, fontSize: 14, marginBottom: 4 },
  step: { flexDirection: 'row', gap: 12, padding: 14, borderRadius: radius.card, backgroundColor: colors.surface },
  stepNo: { width: 28, color: colors.accent, fontFamily: fonts.numericBold, fontSize: 24, textAlign: 'center' },
  stepTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
  stepText: { color: colors.textMuted, fontSize: 13, lineHeight: 19 },
  note: { color: colors.textMuted, fontSize: 12, textAlign: 'center', marginTop: 4 },
  footer: { paddingHorizontal: 16, paddingVertical: 16, gap: 10 },
});
