import { useEffect, useState } from 'react';
import { Keyboard, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { tr } from '@/i18n';
import { colors } from '@/theme';

/**
 * A bar above the iOS keyboard that puts it away. The number pads used for every result have no
 * return key, so without it the keyboard stays up over the buttons once a value is typed.
 */
export function KeyboardDoneBar() {
  const [keyboardHeight, setKeyboardHeight] = useState<number | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    const show = Keyboard.addListener('keyboardWillShow', (e) => setKeyboardHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener('keyboardWillHide', () => setKeyboardHeight(null));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  if (keyboardHeight == null) return null;
  return (
    <View style={[styles.bar, { bottom: keyboardHeight }]}>
      <Pressable accessibilityRole="button" hitSlop={10} onPress={() => Keyboard.dismiss()}>
        <Text style={styles.label}>{tr('收起键盘')}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 44,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    backgroundColor: colors.surfaceRaised,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  label: { color: colors.accent, fontSize: 16, fontWeight: '600' },
});
