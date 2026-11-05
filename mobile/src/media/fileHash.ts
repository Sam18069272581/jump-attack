import { CryptoDigestAlgorithm, digest } from 'expo-crypto';
import type { File } from 'expo-file-system';

/** A file's SHA-256 as lowercase hex, to compare with a published checksum. */
export async function sha256Hex(file: File): Promise<string> {
  const hash = new Uint8Array(await digest(CryptoDigestAlgorithm.SHA256, await file.bytes()));
  return Array.from(hash, (b) => b.toString(16).padStart(2, '0')).join('');
}
