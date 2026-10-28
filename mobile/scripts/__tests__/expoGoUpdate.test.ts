import app from '../../app.json';
import expoPkg from 'expo/package.json';

// Expo Go only loads EAS updates published for its own runtime, "exposdk:<SDK>.0.0".
// When the project moves to a new SDK, this has to move with it or Expo Go refuses the update.
it('publishes EAS updates for the Expo Go runtime of the installed SDK', () => {
  const sdkMajor = expoPkg.version.split('.')[0];
  expect(app.expo.runtimeVersion).toBe(`exposdk:${sdkMajor}.0.0`);
});

// The Expo Go link is exp://u.expo.dev/<project id>?channel-name=main, so the update URL must point at the same project.
it('fetches updates from the Expo project the app is registered to', () => {
  const projectId = app.expo.extra.eas.projectId;
  expect(projectId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  expect(app.expo.updates.url).toBe(`https://u.expo.dev/${projectId}`);
});
