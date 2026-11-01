import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CaptureHeader } from '@/components/capture/CaptureHeader';
import type { CaptureProps } from '@/components/capture/types';
import { Icon, type IconName } from '@/components/Icon';
import { PressScale } from '@/components/motion';
import { Button } from '@/components/ui';
import { tr } from '@/i18n';
import { colors, fonts, radius } from '@/theme';

/**
 * Where a filmed test starts, the same for jumps and VBT sets: the two ways in (film in the app, import a clip) come
 * first, how to film follows.
 */
export default function CaptureStart({ title, subtitle, guide, note, onClose, onImport, onFilm, onManual }: CaptureProps) {
  return (
    <SafeAreaView style={styles.screen}>
      <CaptureHeader title={title} subtitle={subtitle} onClose={onClose} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.choices}>
          {onFilm && <Choice icon="camera" title={tr('App 里直接拍')} detail={guide.film} primary onPress={onFilm} />}
          <Choice icon="gallery" title={tr('从相册导入视频')} detail={guide.import} primary={!onFilm} onPress={onImport} />
        </View>
        <Text style={styles.section}>{guide.stepsTitle}</Text>
        {guide.steps.map((s, i) => (
          <View key={s.title} style={styles.step}>
            <Text style={styles.stepNo}>{i + 1}</Text>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={styles.stepTitle}>{s.title}</Text>
              <Text style={styles.stepText}>{s.text}</Text>
            </View>
          </View>
        ))}
        {note && <Text style={styles.note}>{note}</Text>}
        {onManual && <Button label={tr('手动输入成绩')} variant="ghost" onPress={onManual} />}
      </ScrollView>
    </SafeAreaView>
  );
}

function Choice({ icon, title, detail, primary, onPress }: { icon: IconName; title: string; detail: string; primary: boolean; onPress: () => void }) {
  const fg = primary ? colors.onAccent : colors.text;
  return (
    <PressScale accessibilityLabel={title} accessibilityHint={detail} onPress={onPress} style={[styles.choice, primary ? styles.primary : styles.secondary]}>
      <Icon name={icon} size={30} color={fg} />
      <Text style={[styles.choiceTitle, { color: fg }]}>{title}</Text>
      <Text style={[styles.choiceDetail, { color: primary ? 'rgba(255,255,255,0.8)' : colors.textMuted }]}>{detail}</Text>
    </PressScale>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, gap: 12 },
  choices: { flexDirection: 'row', gap: 12, marginBottom: 8 },
  choice: { flex: 1, minHeight: 148, padding: 16, borderRadius: radius.card, gap: 8, justifyContent: 'flex-end' },
  primary: { backgroundColor: colors.accent },
  secondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  choiceTitle: { fontSize: 17, fontWeight: '700' },
  choiceDetail: { fontSize: 12, lineHeight: 17 },
  section: { color: colors.text, fontSize: 15, fontWeight: '700' },
  step: { flexDirection: 'row', gap: 12, padding: 14, borderRadius: radius.card, backgroundColor: colors.surface },
  stepNo: { width: 28, color: colors.accent, fontFamily: fonts.numericBold, fontSize: 24, textAlign: 'center' },
  stepTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
  stepText: { color: colors.textMuted, fontSize: 13, lineHeight: 19 },
  note: { color: colors.textMuted, fontSize: 12, textAlign: 'center', marginTop: 4 },
});
