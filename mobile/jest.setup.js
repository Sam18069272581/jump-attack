// Tests run as if the phone's "Reduce Motion" setting were on: screens render their final state at once and no
// native-driven animation outlives a test. Tests that check an animation switch it back off with jest.spyOn.
const { AccessibilityInfo } = require('react-native');

AccessibilityInfo.isReduceMotionEnabled = () => Promise.resolve(true);
