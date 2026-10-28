import { Text } from 'react-native';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import { diagnose, type DunkInput } from '@/domain/dunk';

import { ReachHero } from '../ReachHero';

const mockOpen = jest.fn();
jest.mock('@/components/dunkTests', () => ({ openDunkTest: (k: string) => mockOpen(k) }));

const base: DunkInput = { bodyMassKg: 75, standingReachCm: 240, cmj: [], sj: [], approachTouch: [], squat1rm: [], dropJumps: [], fvPct: [] };

function texts(root: ReactTestInstance): string {
  return root
    .findAllByType(Text)
    .map((t) => [t.props.children].flat(Infinity).filter((c) => typeof c === 'string' || typeof c === 'number').join(''))
    .join('\n');
}

async function render(input: DunkInput): Promise<ReactTestRenderer> {
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(<ReachHero diagnosis={diagnose(input)} standingReach={input.standingReachCm} name="Minglu" onSwitchAthlete={() => {}} />);
  });
  return r;
}

it('draws the reach tester around the latest touch and says how far the dunk line is', async () => {
  const r = await render({ ...base, approachTouch: [312, 318] });
  const t = texts(r.root);
  expect(t).toContain('离扣篮线还差');
  expect(t).toContain('2.0');
  expect(t).toContain('扣篮线 320');
  expect(t).toContain('篮筐 305');
  // The tester reads out what it shows for VoiceOver.
  expect(r.root.findByProps({ accessibilityRole: 'image' }).props.accessibilityLabel).toBe('摸高器：助跑摸高 318 cm，扣篮线 320 cm，还差 2.0 cm');
  // 318 cm on the way from the 240 cm standing reach to the 320 cm line.
  expect(r.root.findByProps({ accessibilityRole: 'progressbar' }).props.accessibilityValue).toEqual({ min: 0, max: 100, now: 98 });
  await act(async () => r.root.find((n) => n.props.accessibilityLabel === '测助跑摸高' && typeof n.props.onPress === 'function').props.onPress());
  expect(mockOpen).toHaveBeenCalledWith('approach');
  await act(async () => r.unmount());
});

it('says the reach is there once the touch clears the line', async () => {
  const r = await render({ ...base, approachTouch: [323] });
  expect(texts(r.root)).toContain('已过扣篮线');
  expect(texts(r.root)).toContain('+3.0');
  await act(async () => r.unmount());
});

it('asks for a first touch when there is none', async () => {
  const r = await render(base);
  const t = texts(r.root);
  expect(t).toContain('扣篮线 320 cm');
  expect(t).toContain('还不知道离扣篮多远');
  expect(t).toContain('测一次助跑摸高');
  await act(async () => r.unmount());
});
