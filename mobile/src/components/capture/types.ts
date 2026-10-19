export type CaptureProps = {
  title: string;
  subtitle: string;
  onClose: () => void;
  onImport: () => void;
  /** `fps` is the rate the camera actually delivered. */
  onRecorded: (uri: string, fps: number) => void;
};
