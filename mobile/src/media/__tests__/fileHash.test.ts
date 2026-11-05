import { createHash } from 'crypto';

import type { File } from 'expo-file-system';

import { sha256Hex } from '../fileHash';

// The digest Expo Go runs natively, here from Node.
jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digest: async (_algorithm: string, data: Uint8Array) => new Uint8Array(jest.requireActual('crypto').createHash('sha256').update(data).digest()).buffer,
}));

it('writes the SHA-256 of a file’s bytes as hex, the way checksums are published', async () => {
  const file = { bytes: async () => new TextEncoder().encode('abc') } as unknown as File;
  // FIPS 180-2, appendix B.1: SHA-256("abc").
  expect(await sha256Hex(file)).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  expect(await sha256Hex(file)).toBe(createHash('sha256').update('abc').digest('hex'));
});
