import * as ImagePicker from 'expo-image-picker';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';

import { captureGuide } from '@/components/capture/guides';
import CaptureStart from '@/components/capture/CaptureStart';
import { listTrials } from '@/db/repo';
import { analysisKindFor } from '@/domain/analysisTrials';
import { firstClip, IMPORT_LIMIT } from '@/domain/importQueue';
import { returnsToLogger } from '@/domain/marking';
import { getMetric } from '@/domain/metrics';
import { tr } from '@/i18n';
import { isWeb } from '@/media/runtime';

export default function Capture() {
  // Everything besides the metric and session (`from`, a jump's load, box height) is passed on to marking and the result.
  const { metric, session, ...extra } = useLocalSearchParams<{ metric: string; session: string; from?: string; load?: string; box?: string }>();
  const def = getMetric(metric);
  const db = useSQLiteContext();
  const [attempt, setAttempt] = useState(1);

  // Coming back from the result screen ("再测一次") is the next attempt in the same session.
  useFocusEffect(
    useCallback(() => {
      listTrials(db, session).then((t) => setAttempt(t.length + 1));
    }, [db, session]),
  );

  const pass = { metric, session, ...extra };

  // A logger needs new settings (load, box) for every jump, so it takes one clip at a time.
  const several = !returnsToLogger(extra.from);

  // Jump clips are analysed automatically where a WebView can read their frames (not on the web, not for loaded jumps
  // logged one at a time).
  const auto = def != null && analysisKindFor(def) != null && !isWeb && extra.from !== 'fvp';

  async function importVideo() {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['videos'],
      // Keep the original high-frame-rate file instead of a re-encoded copy.
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current,
      // In the order they were tapped, which is the order they are analysed in.
      ...(several ? { allowsMultipleSelection: true, selectionLimit: IMPORT_LIMIT, orderedSelection: true } : {}),
    });
    if (res.canceled) return;
    const route = firstClip(
      res.assets.map((a) => ({ uri: a.uri, ...(a.assetId ? { asset: a.assetId } : {}) })),
      auto ? 'analyse' : 'mark',
    );
    if (route) router.push({ pathname: route.pathname, params: { ...pass, ...route.params } });
  }

  // The app's camera is a web page in a WebView, which the web version has none of.
  const film = isWeb ? undefined : () => router.push({ pathname: '/measure/camera', params: { ...pass, to: auto ? '/measure/analyse' : '/measure/mark' } });

  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const manual = def?.capture.includes('manual') && !returnsToLogger(extra.from) ? () => router.push({ pathname: '/measure/entry', params: pass }) : undefined;

  return (
    <CaptureStart
      title={tr('录制 · {name}', { name: def?.name ?? metric })}
      subtitle={tr('第 {attempt} 次', { attempt })}
      guide={captureGuide(def?.category ?? 'jump', def?.code)}
      note={
        isWeb
          ? tr('网页版导入后会先播放几帧测出视频帧率；慢动作视频在逐帧页把「拍摄帧率」选成 240。浏览器逐帧定位不如 App 精确，正式测试建议用 Expo Go 版。')
          : tr('慢动作导出后每一帧仍是 1/240 秒。标记页如果显示视频只有 30 fps，把「拍摄帧率」选成 240。')
      }
      onClose={close}
      onImport={importVideo}
      onFilm={film}
      onManual={manual}
    />
  );
}
