/* Read-only check of the web version's database files, for when the app won't open (check.html).
 * expo-sqlite keeps each SQLite file in the browser's private file system (OPFS), folder "expo-sqlite", as a pool of
 * files with a 4096-byte header: the SQLite path it holds (UTF-8, NUL-terminated, up to 512 bytes), then its open
 * flags (uint32, big-endian). An empty path is a free slot. The SQLite file itself starts at byte 4096.
 * Nothing here writes; it only opens files for reading, so it must run while no tab of the app is open. */
const HEADER = 4096;
const MAX_PATH = 512;

/** What one pool file holds, from its first bytes. */
function describe(name, size, head) {
  const bytes = new Uint8Array(head);
  const end = bytes.subarray(0, MAX_PATH).indexOf(0);
  const path = new TextDecoder().decode(bytes.subarray(0, end < 0 ? MAX_PATH : end));
  const flags = bytes.length >= MAX_PATH + 4 ? new DataView(bytes.buffer, bytes.byteOffset).getUint32(MAX_PATH) : 0;
  const magic = new TextDecoder().decode(bytes.subarray(HEADER, HEADER + 15));
  return { name, path, flags, bytes: Math.max(0, size - HEADER), sqlite: magic === 'SQLite format 3' };
}

async function listPool(root) {
  let dir;
  try {
    dir = await root.getDirectoryHandle('expo-sqlite');
  } catch (e) {
    return { files: [], problem: `no expo-sqlite folder (${e.name})` };
  }
  const files = [];
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind !== 'file') continue;
    try {
      const file = await handle.getFile();
      files.push({ ...describe(name, file.size, await file.slice(0, HEADER + 16).arrayBuffer()), file });
    } catch (e) {
      files.push({ name, problem: `${e.name}: ${e.message}` });
    }
  }
  return { files };
}

async function run(doc, nav) {
  const out = doc.getElementById('out');
  const line = (text) => {
    const p = doc.createElement('p');
    p.textContent = text;
    out.appendChild(p);
    return p;
  };
  try {
    const persisted = nav.storage.persisted ? await nav.storage.persisted() : 'unknown';
    const estimate = nav.storage.estimate ? await nav.storage.estimate() : {};
    line(`persisted: ${persisted} · usage: ${Math.round((estimate.usage ?? 0) / 1024)} KB`);
    const { files, problem } = await listPool(await nav.storage.getDirectory());
    if (problem) line(problem);
    line(`${files.length} files in the pool`);
    for (const f of files) {
      if (f.problem) {
        line(`${f.name}: ${f.problem}`);
        continue;
      }
      line(`${f.path || '(free)'} · ${Math.round(f.bytes / 1024)} KB · flags ${f.flags.toString(16)}${f.sqlite ? ' · SQLite' : ''}`);
      if (f.path === '/jump-attack.db' && f.sqlite) {
        const a = doc.createElement('a');
        a.textContent = '下载这份数据库的副本 / Download a copy of this database';
        a.download = 'jump-attack-copy.sqlite';
        a.href = URL.createObjectURL(f.file.slice(HEADER, HEADER + f.bytes, 'application/vnd.sqlite3'));
        line('').appendChild(a);
      }
    }
  } catch (e) {
    line(`check failed: ${e.name}: ${e.message}`);
  }
}

if (typeof document !== 'undefined' && typeof module === 'undefined') void run(document, navigator);

if (typeof module !== 'undefined') module.exports = { describe };
