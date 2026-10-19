import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CaptureHeader } from '@/components/capture/CaptureHeader';
import type { CaptureProps } from '@/components/capture/types';
import { Button } from '@/components/ui';
import { colors, fonts, radius } from '@/theme';

const STEPS = [
  { title: '打开 240 fps 慢动作', text: 'iPhone 设置 → 相机 → 录制慢动作，选「1080p，240 fps」。只需设一次。' },
  { title: '把手机放稳', text: '放在地面或三脚架上，别手持。距离约 1.5 米，镜头对准脚踝高度，脚和地面都要在画面里。' },
  { title: '用「慢动作」拍', text: '打开相机切到「慢动作」。起跳前 2 秒开拍，落地站稳 2 秒后再停，让整个跳跃都在慢放段里。' },
  { title: '导入并逐帧标记', text: '回到这里点下面的按钮选视频，然后找到起跳帧和落地帧。' },
];

/** Expo Go fallback: film with the system camera's slow-motion mode, then import the clip. */
export default function SlowMoImport({ title, subtitle, onClose, onImport }: CaptureProps) {
  return (
    <SafeAreaView style={styles.screen}>
      <CaptureHeader title={title} subtitle={subtitle} onClose={onClose} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.lead}>用 iPhone 自带相机的慢动作拍，再导入这里测量。</Text>
        {STEPS.map((s, i) => (
          <View key={s.title} style={styles.step}>
            <Text style={styles.stepNo}>{i + 1}</Text>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={styles.stepTitle}>{s.title}</Text>
              <Text style={styles.stepText}>{s.text}</Text>
            </View>
          </View>
        ))}
        <Text style={styles.note}>现在是 Expo Go 预览版，App 内直接录 240 fps 需要安装正式开发版。</Text>
      </ScrollView>
      <View style={styles.footer}>
        <Button label="从相册导入视频" onPress={onImport} />
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
  footer: { paddingHorizontal: 16, paddingVertical: 16 },
});
