import * as ImagePicker from 'expo-image-picker';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';

import { captureGuide } from '@/components/capture/guides';
import SlowMoImport from '@/components/capture/SlowMoImport';
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

  async function importVideo() {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['videos'],
      // Keep the original high-frame-rate file instead of a re-encoded copy.
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current,
      // In the order they were tapped, which is the order they are analysed in.
      ...(several ? { allowsMultipleSelection: true, selectionLimit: IMPORT_LIMIT, orderedSelection: true } : {}),
    });
    if (res.canceled) return;
    // Jump clips are analysed automatically where a WebView can read their frames (not on the web, not for loaded jumps
    // logged one at a time).
    const auto = def != null && analysisKindFor(def) != null && !isWeb && extra.from !== 'fvp';
    const route = firstClip(
      res.assets.map((a) => ({ uri: a.uri, ...(a.assetId ? { asset: a.assetId } : {}) })),
      auto ? 'analyse' : 'mark',
    );
    if (route) router.push({ pathname: route.pathname, params: { ...pass, ...route.params } });
  }

  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const manual = def?.capture.includes('manual') && !returnsToLogger(extra.from) ? () => router.push({ pathname: '/measure/entry', params: pass }) : undefined;

  return (
    <SlowMoImport
      title={tr('录制 · {name}', { name: def?.name ?? metric })}
      subtitle={tr('第 {attempt} 次', { attempt })}
      guide={captureGuide(def?.category ?? 'jump', def?.code)}
      onClose={close}
      onImport={importVideo}
      onManual={manual}
    />
  );
}
