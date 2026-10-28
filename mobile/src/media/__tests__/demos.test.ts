import { deleteDemoClip, demoClip, saveDemoClip } from '../demos';

// A small in-memory file system with the slice of expo-file-system's File / Directory API the demos use.
jest.mock('expo-file-system', () => {
  const files = new Set<string>();
  const dirs = new Set<string>();
  const join = (parent: { uri: string } | string, name?: string) => (name == null ? String(parent) : `${typeof parent === 'string' ? parent : parent.uri}/${name}`);
  class File {
    uri: string;
    constructor(parent: { uri: string } | string, name?: string) {
      this.uri = join(parent, name);
    }
    get name() {
      return this.uri.split('/').pop()!;
    }
    get extension() {
      const m = /\.[^./]+$/.exec(this.name);
      return m ? m[0] : '';
    }
    async copy(dest: File) {
      files.add(dest.uri);
    }
    delete() {
      files.delete(this.uri);
    }
  }
  class Directory {
    uri: string;
    constructor(parent: { uri: string } | string, name?: string) {
      this.uri = join(parent, name);
    }
    get exists() {
      return dirs.has(this.uri);
    }
    create() {
      dirs.add(this.uri);
    }
    list() {
      return [...files].filter((f) => f.startsWith(`${this.uri}/`)).map((f) => new File(f));
    }
  }
  return { File, Directory, Paths: { document: { uri: 'file:///docs' } } };
});

it('keeps one clip per exercise, replacing the older one, until it is deleted', async () => {
  expect(demoClip('pogo')).toBeNull();
  expect(await saveDemoClip('pogo', 'file:///picked/IMG_1.MOV')).toBe('file:///docs/demos/pogo.MOV');
  expect(await saveDemoClip('pogo', 'file:///picked/clip.mp4')).toBe('file:///docs/demos/pogo.mp4');
  expect(demoClip('pogo')).toBe('file:///docs/demos/pogo.mp4');
  // Another exercise whose code starts the same way is a different clip.
  await saveDemoClip('pogo_2', 'file:///picked/x.mov');
  deleteDemoClip('pogo');
  expect(demoClip('pogo')).toBeNull();
  expect(demoClip('pogo_2')).toBe('file:///docs/demos/pogo_2.mov');
});
