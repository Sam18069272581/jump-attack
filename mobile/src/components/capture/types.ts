import type { CaptureGuide } from './guides';

export type CaptureProps = {
  title: string;
  subtitle: string;
  guide: CaptureGuide;
  onClose: () => void;
  onImport: () => void;
  /** Present where the app can film the test itself (not on the web). */
  onFilm?: () => void;
  /** Present when the result can also be typed in. */
  onManual?: () => void;
};
