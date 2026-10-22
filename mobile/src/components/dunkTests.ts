import { router } from 'expo-router';

import { newSessionId } from '@/db/repo';
import type { DunkMetricKey, Missing } from '@/domain/dunk';
import { APPROACH_TOUCH } from '@/domain/metrics';

/** Where to go to measure a metric or fill in what is missing. */
export function openDunkTest(key: DunkMetricKey | Missing) {
  const capture = (metric: string) => router.push({ pathname: '/measure/capture', params: { metric, session: newSessionId() } });
  switch (key) {
    case 'body_mass':
    case 'standing_reach':
      return router.navigate('/me');
    case 'squat':
    case 'squat_ratio':
      return router.push({ pathname: '/vbt/[lift]', params: { lift: 'vbt_squat', session: newSessionId() } });
    case 'drop_jump':
    case 'rsi':
    case 'contact':
      return router.push({ pathname: '/jumps/dj', params: { session: newSessionId() } });
    case 'fv':
      return router.push({ pathname: '/jumps/fvp', params: { session: newSessionId() } });
    case 'approach':
    case 'approach_gain':
      return capture(APPROACH_TOUCH.code);
    case 'cmj':
      return capture('cmj');
    case 'eur':
      return router.push('/jumps');
  }
}
