import type { CaptureGuide } from './guides';

export type CaptureProps = {
  title: string;
  subtitle: string;
  guide: CaptureGuide;
  onClose: () => void;
  onImport: () => void;
  /** Present when the result can also be typed in. */
  onManual?: () => void;
};
