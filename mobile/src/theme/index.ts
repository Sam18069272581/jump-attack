import { StyleSheet } from 'react-native';

// Tokens taken from the design canvas (design/*.dc.html).
export const colors = {
  bg: '#0F1115',
  surface: '#191C22',
  surfaceRaised: '#2A2F38',
  tabBar: '#13161A',
  border: '#2E333C',
  divider: '#22262E',
  text: '#F2F3F5',
  textSoft: '#D5D8DE',
  textMuted: '#9AA1AD',
  textFaint: '#5A616D',
  accent: '#D4FF3F',
  accentTile: '#2A3312',
  onAccent: '#0F1115',
  good: '#6EE7B7',
  warn: '#FF9F43',
  record: '#FF5A4E',
  blue: '#4FD1FF',
  purple: '#C9A7FF',
};

export const fonts = {
  /** Numbers and short codes. */
  numeric: 'BarlowCondensed_600SemiBold',
  numericBold: 'BarlowCondensed_700Bold',
};

export const radius = { card: 20, row: 18, button: 16, chip: 14 };

export const text = StyleSheet.create({
  title: { color: colors.text, fontSize: 26, fontWeight: '700' },
  heading: { color: colors.text, fontSize: 20, fontWeight: '700' },
  section: { color: colors.text, fontSize: 15, fontWeight: '700' },
  body: { color: colors.text, fontSize: 15 },
  muted: { color: colors.textMuted, fontSize: 13 },
  caption: { color: colors.textMuted, fontSize: 11 },
});
