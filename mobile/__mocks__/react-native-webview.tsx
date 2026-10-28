// Jest has no native WebView. Screens that hold one render it as an empty view that never posts a message, the way a
// page that is still loading behaves; tests that drive the page mock it themselves.
import { View } from 'react-native';

export function WebView() {
  return <View />;
}
