import { dropTake, newTakeFile, pruneTakes } from '../takes';

// The slice of expo-file-system the takes folder uses, in memory.
jest.mock('expo-file-system', () => {
  const files = new Set<string>();
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
    get exists() {
      return files.has(this.uri);
    }
    create() {
      files.add(this.uri);
    }
    delete() {
      files.delete(this.uri);
    }
  }
  class Directory {
    uri: string;
    constructor(parent: { uri: string } | string, ...names: string[]) {
      this.uri = join(parent, ...names);
    }
    get exists() {
      return dirs.has(this.uri);
    }
    create() {
      dirs.add(this.uri);
    }
    list() {
      return [...files].filter((f) => f.startsWith(`${this.uri}/`) && !f.slice(this.uri.length + 1).includes('/')).map((f) => new File(f));
    }
  }
  return { File, Directory, Paths: { document: 'file:///app/Documents' } };
});

let now = 1_000;
beforeEach(() => {
  jest.spyOn(Date, 'now').mockImplementation(() => (now += 1000));
});

it('gives each take a new file of its own in the documents folder', () => {
  const a = newTakeFile('mp4');
  expect(a.uri).toMatch(/^file:\/\/\/app\/Documents\/technique\/take-\d+\.mp4$/);
  expect(a.exists).toBe(true);
  expect(newTakeFile('mp4').uri).not.toBe(a.uri);
  dropTake(a.uri);
  expect(a.exists).toBe(false);
});

it('keeps the saved takes’ files and drops the rest: a take never saved, or one deleted', () => {
  const saved = newTakeFile('mp4');
  const left = newTakeFile('mp4');
  // iOS can move the app's folder in an update, so a saved take is known by its file's name, not its whole path.
  pruneTakes([saved.uri.replace('file:///app/', 'file:///moved/app/')]);
  expect(saved.exists).toBe(true);
  expect(left.exists).toBe(false);
});
