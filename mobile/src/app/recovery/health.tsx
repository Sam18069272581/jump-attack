import * as Clipboard from 'expo-clipboard';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Card } from '@/components/ui';
import { SAMPLE_IMPORT } from '@/domain/healthImport';
import { getCategory } from '@/domain/metrics';
import { localized, tr } from '@/i18n';
import { hasHealthConsent, setHealthConsent } from '@/state/healthConsent';
import { colors, fonts, text } from '@/theme';

const COLOR = getCategory('recovery').color;

const STEPS: { title: string; body: string }[] = localized([
  { title: '新建快捷指令', body: '打开「快捷指令」App，点右上角「+」，命名为「恢复数据」。' },
  {
    title: '读取 HRV、静息心率、呼吸',
    body: '添加操作「查找健康样本」，类型选「心率变异性」，排序方式「开始日期」，顺序「最新优先」，打开「限制」设为 1。再用同样的设置各加一个「静息心率」和「呼吸速率」。',
  },
  {
    title: '读取昨晚睡眠（可选）',
    body: '再加一个「查找健康样本」，类型选「睡眠分析」，条件选「全部满足」：开始日期在最近 1 天、值不是「在床上」、值不是「清醒」。接着加「获取健康样本的详细信息」取「时长」，再加「计算统计数据」选「总和」。不加这一步也行，睡眠到时手填。',
  },
  {
    title: '拼成文本',
    body: '添加「文本」操作，每行写一个名称加冒号，冒号后面插入上面对应的结果（点键盘上方的变量）：\n\nHRV: 〔心率变异性〕\n静息心率: 〔静息心率〕\n睡眠: 〔总和〕\n呼吸: 〔呼吸速率〕',
  },
  { title: '复制并回到 App', body: '添加「拷贝到剪贴板」。想跑完直接回来，可以再加「打开 App」选 Expo Go。' },
  { title: '第一次运行', body: 'iOS 会问是否允许「快捷指令」读取这些健康数据，选允许。这一步由苹果管，随时可以在「健康」App → 共享 → App 里关掉。' },
], 'title', 'body');

/** How to set up the Shortcut that copies Apple Health data, and the user's consent to import it. */
export default function HealthImportGuide() {
  const [consent, setConsent] = useState(false);

  useFocusEffect(
    useCallback(() => {
      hasHealthConsent().then(setConsent, () => setConsent(false));
    }, []),
  );

  async function copySample() {
    await Clipboard.setStringAsync(tr(SAMPLE_IMPORT));
    Alert.alert(tr('已复制示例'), tr('回到恢复页点「从苹果健康导入」试一下。'));
  }

  async function withdraw() {
    await setHealthConsent(false);
    setConsent(false);
  }

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={text.body}>{tr('Expo Go 里的 App 不能直接读「健康」，所以借 iPhone 自带的「快捷指令」读出今天的数据并复制，回到恢复页点一下就能填好。设置一次，以后每天起床跑一下就行，也可以加到主屏幕或设成自动化。')}</Text>

        {STEPS.map((s, i) => (
          <Card key={s.title} style={{ gap: 6 }}>
            <View style={styles.stepHead}>
              <Text style={styles.stepNo}>{i + 1}</Text>
              <Text style={text.section}>{s.title}</Text>
            </View>
            <Text style={text.body}>{s.body}</Text>
          </Card>
        ))}

        <Card style={{ gap: 8 }}>
          <Text style={text.section}>{tr('格式')}</Text>
          <Text style={text.caption}>{tr('每行「名称: 数字」，单位可带可不带。名称认 HRV/心率变异性、静息心率、睡眠、呼吸；睡眠可以是小时、分钟、秒或「7小时24分钟」。没有的项留空即可。')}</Text>
          <Text style={styles.sample}>{tr(SAMPLE_IMPORT)}</Text>
          <Button label={tr('复制示例试一下')} variant="secondary" onPress={copySample} />
        </Card>

        <Card style={{ gap: 8 }}>
          <Text style={text.section}>{tr('隐私')}</Text>
          <Text style={text.caption}>{tr('导入的数据存在这台手机的 App 里；登录了云端同步时会随全部数据备份到你自己的账号。App 只在你点导入时读一次剪贴板。{p}', { p: consent ? tr('你已同意导入健康数据。') : tr('你还没有同意导入，第一次导入时会先问你。') })}</Text>
          {consent && <Button label={tr('撤回同意')} variant="ghost" onPress={withdraw} />}
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, gap: 12 },
  stepHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepNo: { color: COLOR, fontFamily: fonts.numericBold, fontSize: 22, width: 18 },
  sample: { color: colors.text, fontFamily: fonts.numeric, fontSize: 16, backgroundColor: colors.surfaceRaised, borderRadius: 10, padding: 12 },
});
