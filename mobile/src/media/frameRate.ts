/** Native players report the frame rate with the video track (sourceLoad), so there is nothing to probe. */
export async function probeFrameRate(_uri: string): Promise<number | null> {
  return null;
}
