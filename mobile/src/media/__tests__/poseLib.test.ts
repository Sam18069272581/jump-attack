import { classicBundle, clearPoseRuns, downloadPoseLib, MEDIAPIPE_VERSION, POSE_CDN, POSE_DOWNLOAD_BYTES, POSE_FILES, poseLibReady, stagePosePage, unstagePosePage } from '../poseLib';

// An in-memory file system with the slice of expo-file-system's File / Directory API the library store uses, and a
// server that answers each download with the bytes `mockServed` says (the release's own size unless a test cuts it).
const mockServed = new Map<string, number>();
const mockDownloads: string[] = [];
/**
 * A write to a file ending so fails part-way, as iOS's in-place write does when the phone is full; or, `killed`, the
 * app is closed part-way through it.
 */
const mockCut: { name: string | null; killed?: boolean } = { name: null };
jest.mock('expo-file-system', () => {
  const files = new Map<string, string>();
  const sizes = new Map<string, number>();
  const dirs = new Set<string>();
  const join = (parent: { uri: string } | string, ...names: string[]) => [typeof parent === 'string' ? parent : parent.uri, ...names].join('/');
  class File {
    uri: string;
    constructor(parent: { uri: string } | string, ...names: string[]) {
      this.uri = join(parent, ...names);
    }
    get name() {
      return this.uri.split('/').pop()!;
    }
    get extension() {
      const m = /\.[^./]+$/.exec(this.name);
      return m ? m[0] : '';
    }
    get exists() {
      return files.has(this.uri);
    }
    get size() {
      return sizes.get(this.uri) ?? files.get(this.uri)?.length ?? 0;
    }
    // As in SDK 58: the write is done on another thread, and the promise settles once it is.
    async write(content: string) {
      await new Promise((r) => setTimeout(r, 1));
      if (mockCut.killed && mockCut.name && this.uri.endsWith(mockCut.name)) {
        // The file holds what got written, and nothing settles.
        files.set(this.uri, content.slice(0, 7));
        sizes.delete(this.uri);
        return new Promise<void>(() => {});
      }
      if (mockCut.name && this.uri.endsWith(mockCut.name)) {
        files.set(this.uri, content.slice(0, Math.floor(content.length / 3)));
        sizes.delete(this.uri);
        throw new Error(`The file “${this.name}” couldn’t be saved because there isn’t enough space.`);
      }
      files.set(this.uri, content);
      sizes.delete(this.uri);
    }
    async text() {
      return files.get(this.uri) ?? '';
    }
    async copy(dest: File) {
      files.set(dest.uri, files.get(this.uri) ?? 'clip');
    }
    delete() {
      files.delete(this.uri);
      sizes.delete(this.uri);
    }
    static createDownloadTask(url: string, dest: File, opts: { onProgress?: (p: { bytesWritten: number; totalBytes: number }) => void }) {
      return {
        async downloadAsync() {
          mockDownloads.push(url);
          const bytes = mockServed.get(url)!;
          opts.onProgress?.({ bytesWritten: bytes / 2, totalBytes: bytes });
          files.set(dest.uri, url.endsWith('.mjs') ? 'var a=1;export{a as A};' : 'x');
          sizes.set(dest.uri, bytes);
          opts.onProgress?.({ bytesWritten: bytes, totalBytes: bytes });
          return dest;
        },
      };
    }
  }
  class Directory {
    uri: string;
    constructor(parent: { uri: string } | string, ...names: string[]) {
      this.uri = join(parent, ...names);
    }
    get name() {
      return this.uri.split('/').pop()!;
    }
    get exists() {
      return dirs.has(this.uri);
    }
    create() {
      const parts = this.uri.split('/');
      for (let i = 1; i <= parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
    }
    delete() {
      for (const d of [...dirs]) if (d === this.uri || d.startsWith(`${this.uri}/`)) dirs.delete(d);
      for (const f of [...files.keys()]) if (f.startsWith(`${this.uri}/`)) files.delete(f);
    }
    list() {
      const kids = new Set<string>();
      for (const d of dirs) if (d.startsWith(`${this.uri}/`)) kids.add(d.slice(this.uri.length + 1).split('/')[0]);
      return [...kids].map((k) => new Directory(this, k));
    }
  }
  return { File, Directory, Paths: { document: 'file:///app/Documents' }, __files: files };
});

const { __files: files } = jest.requireMock('expo-file-system') as { __files: Map<string, string> };

beforeEach(() => {
  files.clear();
  mockDownloads.length = 0;
  mockCut.name = null;
  mockCut.killed = false;
  for (const f of POSE_FILES) mockServed.set(f.url, f.bytes);
});

describe('classicBundle', () => {
  it('runs the ES module as a classic script: its code strict and its names its own, its exports on MPVision', () => {
    const esm = 'var t=1;let i=2;class A{}function f(){return t+i}export{f as run,A as Thing,t};\n//# sourceMappingURL=vision_bundle_mjs.js.map\n';
    const global: { MPVision?: { run: () => number; Thing: unknown; t: number } } = {};
    new Function('self', classicBundle(esm))(global);
    expect(global.MPVision!.run()).toBe(3);
    expect(typeof global.MPVision!.Thing).toBe('function');
    expect(global.MPVision!.t).toBe(1);
    expect('i' in globalThis).toBe(false);
    // Module code is strict: the directive opens the function the code runs in. (Jest's sandbox doesn't enforce it.)
    expect(classicBundle(esm).startsWith('(function () {\n"use strict";\n')).toBe(true);
  });

  it('refuses a bundle with no export list at the end', () => {
    expect(() => classicBundle('var a = 1;')).toThrow('no export list');
  });
});

describe('the files', () => {
  it('are pinned to MediaPipe 0.10.35 and model version 1, never "latest" (1.x sends usage metrics to Google)', () => {
    expect(MEDIAPIPE_VERSION).toBe('0.10.35');
    for (const f of POSE_FILES) {
      expect(f.url).toMatch(/@0\.10\.35\/|\/float16\/1\//);
      expect(f.url).not.toContain('latest');
    }
    expect(Object.values(POSE_CDN).every((u) => POSE_FILES.some((f) => f.url === u))).toBe(true);
  });

  it('come to about 21 MB, most of it the wasm runtime and the model', () => {
    expect(POSE_DOWNLOAD_BYTES).toBe(136_993 + 322_044 + 11_153_617 + 9_398_198);
  });
});

describe('downloadPoseLib', () => {
  it('downloads each file once, says how far it has got, and makes the classic script', async () => {
    expect(poseLibReady()).toBe(false);
    const progress: number[] = [];
    await downloadPoseLib((p) => progress.push(p));
    expect(mockDownloads).toEqual(POSE_FILES.map((f) => f.url));
    expect(progress[progress.length - 1]).toBe(1);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
    expect(files.get(`file:///app/Documents/pose/lib/${MEDIAPIPE_VERSION}/vision.js`)).toContain('self.MPVision = {A:a}');
    expect(poseLibReady()).toBe(true);
    await downloadPoseLib();
    expect(mockDownloads).toHaveLength(POSE_FILES.length);
  });

  it('throws on a cut download and leaves nothing half-written to be taken for whole', async () => {
    mockServed.set(POSE_FILES[3].url, 1_000_000);
    await expect(downloadPoseLib()).rejects.toThrow('pose_landmarker_full.task 下载不完整');
    expect(files.has(`file:///app/Documents/pose/lib/${MEDIAPIPE_VERSION}/pose_landmarker_full.task`)).toBe(false);
    expect(poseLibReady()).toBe(false);
    // The next try picks up where this one stopped.
    mockServed.set(POSE_FILES[3].url, POSE_FILES[3].bytes);
    mockDownloads.length = 0;
    await downloadPoseLib();
    expect(mockDownloads).toEqual([POSE_FILES[3].url]);
  });

  it('leaves no cut classic script behind when writing it fails, so the download is offered again', async () => {
    mockCut.name = '/vision.js';
    await expect(downloadPoseLib()).rejects.toThrow('enough space');
    expect(files.has(`file:///app/Documents/pose/lib/${MEDIAPIPE_VERSION}/vision.js`)).toBe(false);
    expect(poseLibReady()).toBe(false);
    mockCut.name = null;
    await downloadPoseLib();
    expect(poseLibReady()).toBe(true);
  });

  it('doesn’t take a classic script cut by the app being closed while writing it for whole', async () => {
    mockCut.name = '/vision.js';
    mockCut.killed = true;
    void downloadPoseLib();
    for (let k = 0; k < 20; k++) await new Promise((r) => setTimeout(r, 2));
    // The next launch: a cut script would load without defining the library, on every try.
    expect(files.get(`file:///app/Documents/pose/lib/${MEDIAPIPE_VERSION}/vision.js`)).toHaveLength(7);
    expect(poseLibReady()).toBe(false);
    mockCut.killed = false;
    mockCut.name = null;
    await downloadPoseLib();
    expect(poseLibReady()).toBe(true);
  });
});

describe('stagePosePage', () => {
  it('puts the page and a copy of the clip in a run folder beside the library, and takes them away again', async () => {
    files.set('file:///tmp/picked/IMG_0001.MOV', 'video');
    const s = await stagePosePage((clip) => `<video src="${clip}">`, 'file:///tmp/picked/IMG_0001.MOV');
    expect(s.root).toBe('file:///app/Documents/pose');
    expect(s.dir.startsWith('file:///app/Documents/pose/run-')).toBe(true);
    expect(files.get(s.page)).toBe('<video src="clip.MOV">');
    expect(files.get(`${s.dir}/clip.MOV`)).toBe('video');
    unstagePosePage(s.dir);
    expect(files.has(s.page)).toBe(false);
  });

  it('clears run folders left behind, and keeps the library', async () => {
    await downloadPoseLib();
    const s = await stagePosePage(() => '<p>camera</p>');
    clearPoseRuns();
    expect(files.has(s.page)).toBe(false);
    expect(poseLibReady()).toBe(true);
  });
});
