import { StyleSheet } from 'react-native';

// "Paper court" palette: a light, print-like ground, court blue for actions and the gap, rim orange for the basket.
// Text colours clear 4.5:1 on bg and surface; textFaint is only for placeholders and disabled labels.
export const colors = {
  bg: '#F1ECE2',
  surface: '#FFFFFF',
  surfaceRaised: '#E8E1D4',
  tabBar: '#F7F3EC',
  border: '#D9CFBE',
  divider: '#E3DBCD',
  text: '#17130E',
  textSoft: '#3A332A',
  textMuted: '#665D52',
  textFaint: '#8F8474',
  accent: '#2340C8',
  accentTile: '#E1E6FA',
  onAccent: '#FFFFFF',
  good: '#1A6E3D',
  warn: '#985100',
  record: '#B92F1C',
  blue: '#0B6F6E',
  purple: '#6A46BE',
  /** The basket: rim, net and anything about the hoop. */
  rim: '#D9541E',
  /** Vanes and pole of the reach tester drawn behind the home screen. */
  vane: '#17130E',
  pole: '#C9BEAA',
};

export const fonts = {
  /** Numbers and short codes: Big Shoulders, Chicago's street-sign face. Chinese stays on the system font (PingFang). */
  numeric: 'BigShouldersDisplay_700Bold',
  numericBold: 'BigShouldersDisplay_800ExtraBold',
};

export const radius = { card: 20, row: 18, button: 16, chip: 14 };

/** Motion timing shared by every screen (ms), so entrances and presses feel like one app. */
export const motion = {
  enter: 420,
  stagger: 60,
  rise: 14,
  pressScale: 0.97,
  count: 1100,
  countDelay: 250,
  press: { speed: 40, bounciness: 6 },
};

export const text = StyleSheet.create({
  title: { color: colors.text, fontSize: 26, fontWeight: '700' },
  heading: { color: colors.text, fontSize: 20, fontWeight: '700' },
  section: { color: colors.text, fontSize: 15, fontWeight: '700' },
  body: { color: colors.text, fontSize: 15 },
  muted: { color: colors.textMuted, fontSize: 13 },
  caption: { color: colors.textMuted, fontSize: 11 },
});
