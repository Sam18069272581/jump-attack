import * as ImagePicker from 'expo-image-picker';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';

import { captureGuide } from '@/components/capture/guides';
import SlowMoImport from '@/components/capture/SlowMoImport';
import { listTrials } from '@/db/repo';
import { analysisKindFor } from '@/domain/analysisTrials';
import { returnsToLogger } from '@/domain/marking';
import { getMetric } from '@/domain/metrics';
import { isWeb } from '@/media/runtime';

export default function Capture() {
  // Everything besides the metric and session (`from`, a set's or jump's load, bar travel, box height) is passed on to marking and the result.
  const { metric, session, ...extra } = useLocalSearchParams<{ metric: string; session: string; from?: string; load?: string; reps?: string; rom?: string; box?: string }>();
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

  async function importVideo() {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['videos'],
      // Keep the original high-frame-rate file instead of a re-encoded copy.
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current,
    });
    if (res.canceled || !res.assets[0]) return;
    const { uri, assetId } = res.assets[0];
    // The file's own frame rate is read on the next screen; 0 means the picker didn't report one. Jump clips are analysed
    // automatically where a WebView can read their frames (not on the web, not for loaded jumps logged one at a time).
    const auto = def != null && analysisKindFor(def) != null && !isWeb && extra.from !== 'fvp';
    router.push({ pathname: auto ? '/measure/analyse' : '/measure/mark', params: { ...pass, uri, fps: '0', ...(assetId ? { asset: assetId } : {}) } });
  }

  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const manual = def?.capture.includes('manual') && !returnsToLogger(extra.from) ? () => router.push({ pathname: '/measure/entry', params: pass }) : undefined;

  return (
    <SlowMoImport
      title={`录制 · ${def?.name ?? metric}`}
      subtitle={`第 ${attempt} 次`}
      guide={captureGuide(def?.category ?? 'jump', def?.code)}
      onClose={close}
      onImport={importVideo}
      onManual={manual}
    />
  );
}
