// eslint-disable-next-line @typescript-eslint/no-require-imports
const { describe: describePoolFile } = require('../../public/check');

/** A pool file as expo-sqlite's AccessHandlePoolVFS writes it: path, NUL, flags at byte 512, the SQLite file at 4096. */
function poolFile(path: string, flags: number, sqlite: string): ArrayBuffer {
  const bytes = new Uint8Array(4096 + 16);
  bytes.set(new TextEncoder().encode(path), 0);
  new DataView(bytes.buffer).setUint32(512, flags);
  bytes.set(new TextEncoder().encode(sqlite), 4096);
  return bytes.buffer;
}

it('reads which SQLite file a pool file holds and how big it is', () => {
  // 0x100 = SQLITE_OPEN_MAIN_DB, 0x6 = READWRITE | CREATE
  expect(describePoolFile('abc', 4096 + 40960, poolFile('/jump-attack.db', 0x106, 'SQLite format 3\0'))).toEqual({
    name: 'abc',
    path: '/jump-attack.db',
    flags: 0x106,
    bytes: 40960,
    sqlite: true,
  });
});

it('reports a free slot as an empty path', () => {
  expect(describePoolFile('xyz', 4096, poolFile('', 0, ''))).toEqual({ name: 'xyz', path: '', flags: 0, bytes: 0, sqlite: false });
});
