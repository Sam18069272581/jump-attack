// Supabase's auth errors, in the app's own words.
import { authProblem } from '../client';

jest.mock('expo-sqlite/kv-store', () => ({ __esModule: true, default: {} }));

it('says plainly when the cloud takes no new sign-ups, as after turning them off in Supabase', () => {
  const closed = '这个云端现在不开放注册，请找管理员邀请你。';
  expect(authProblem('Signups not allowed for this instance')).toBe(closed);
  expect(authProblem('Email signups are disabled')).toBe(closed);
});

it('keeps the message of an error it does not know', () => {
  expect(authProblem('Something else')).toBe('登录失败：Something else');
});
