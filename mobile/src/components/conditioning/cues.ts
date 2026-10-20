import { setAudioModeAsync, useAudioPlayer, type AudioPlayer } from 'expo-audio';
import * as Haptics from 'expo-haptics';
import * as Speech from 'expo-speech';
import { useEffect, useMemo, useRef, useState } from 'react';

/** A sound or spoken line at `at` seconds on a test's clock (negative = before the start signal). */
export type Cue = { at: number; kind: 'go' | 'beep' | 'say'; text?: string };

export type Cues = { go: () => void; beep: () => void; say: (text: string) => void };

function replay(p: AudioPlayer) {
  p.seekTo(0);
  p.play();
}

/** Start signal, short beep and Chinese voice, audible with the silent switch on and ducking any music. */
export function useCues(): Cues {
  const goPlayer = useAudioPlayer(require('../../../assets/sounds/go.wav'));
  const beepPlayer = useAudioPlayer(require('../../../assets/sounds/beep.wav'));

  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'duckOthers' }).catch(() => {});
    return () => {
      Speech.stop();
    };
  }, []);

  return useMemo(
    () => ({
      go: () => {
        replay(goPlayer);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      },
      beep: () => {
        replay(beepPlayer);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      },
      say: (text: string) => Speech.speak(text, { language: 'zh-CN', rate: 1.05 }),
    }),
    [goPlayer, beepPlayer],
  );
}

// A cue this late (the app was in the background, say) is dropped rather than played out of time.
const STALE_S = 1.5;

/**
 * Seconds since `zeroAt` (a Date.now() timestamp), refreshed ten times a second, firing each cue as its time passes.
 * Time comes from the wall clock, not from counting ticks, so the clock does not drift when JS is busy.
 * Pass `zeroAt = null` to stop.
 */
export function useTimeline(zeroAt: number | null, cues: Cue[], player: Cues): number {
  const [now, setNow] = useState(() => Date.now());
  const next = useRef(0);

  useEffect(() => {
    next.current = 0;
  }, [zeroAt, cues]);

  useEffect(() => {
    if (zeroAt == null) return;
    const tick = () => {
      const t = Date.now();
      const elapsed = (t - zeroAt) / 1000;
      while (next.current < cues.length && cues[next.current].at <= elapsed) {
        const c = cues[next.current++];
        if (elapsed - c.at > STALE_S) continue;
        if (c.kind === 'say') player.say(c.text ?? '');
        else player[c.kind]();
      }
      setNow(t);
    };
    tick();
    const id = setInterval(tick, 50);
    return () => clearInterval(id);
  }, [zeroAt, cues, player]);

  return zeroAt == null ? 0 : (now - zeroAt) / 1000;
}

/** Spoken 3-2-1 and the start signal before `at`. */
export function countIn(at = 0): Cue[] {
  return [
    { at: at - 3, kind: 'say', text: '三' },
    { at: at - 2, kind: 'say', text: '二' },
    { at: at - 1, kind: 'say', text: '一' },
    { at, kind: 'go' },
  ];
}
