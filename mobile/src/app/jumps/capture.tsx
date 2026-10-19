import * as ImagePicker from 'expo-image-picker';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState, type ComponentType } from 'react';

import SlowMoImport from '@/components/capture/SlowMoImport';
import type { CaptureProps } from '@/components/capture/types';
import { listTrials } from '@/db/repo';
import { getMetric } from '@/domain/metrics';
import { isExpoGo } from '@/media/runtime';

// Loaded only outside Expo Go: vision-camera touches its native module as soon as it is imported.
const NativeCapture: ComponentType<CaptureProps> | null = isExpoGo
  ? null
  : // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('@/components/capture/NativeCapture').default;

export default function Capture() {
  // `from` is passed through to the result screen so 完成 returns to where the test was started.
  const { metric, session, from } = useLocalSearchParams<{ metric: string; session: string; from?: string }>();
  const def = getMetric(metric);
  const db = useSQLiteContext();
  const [attempt, setAttempt] = useState(1);

  // Coming back from the result screen ("再测一次") is the next attempt in the same session.
  useFocusEffect(
    useCallback(() => {
      listTrials(db, session).then((t) => setAttempt(t.length + 1));
    }, [db, session]),
  );

  async function importVideo() {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['videos'],
      // Keep the original high-frame-rate file instead of a re-encoded copy.
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current,
    });
    if (res.canceled || !res.assets[0]) return;
    goMark(res.assets[0].uri, 0);
  }

  function goMark(uri: string, recordedFps: number) {
    router.push({ pathname: '/jumps/mark', params: { metric, session, uri, fps: String(recordedFps), ...(from ? { from } : {}) } });
  }

  const close = () => (router.canGoBack() ? router.back() : router.replace('/jumps'));

  const Screen = NativeCapture ?? SlowMoImport;
  return <Screen title={`录制 · ${def?.name ?? metric}`} subtitle={`第 ${attempt} 次`} onClose={close} onImport={importVideo} onRecorded={goMark} />;
}
