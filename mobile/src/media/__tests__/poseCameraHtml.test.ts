import { Blob as NodeBlob } from 'buffer';

import { decodePose, LM, type Pose } from '@/domain/pose';
import { standing } from '@/domain/testing/standing';

import { CAMERA_BITRATE, CHUNK_BYTES, poseCameraHtml } from '../poseCameraHtml';
import { FakeCanvas, lit, runPage, type Page, type Picture } from '../testing/posePage';

/**
 * The camera page's script, run against a minimal DOM: a stand-in camera that films a scene, a stand-in recorder, a
 * clock the test moves on, and the stand-in pose model of media/testing/posePage.ts, which misses people too small in
 * the square it is given.
 */

const W = 1280;
const H = 720;

/** The setup checks' good picture (domain/__tests__/poseSetup.test.ts): the athlete on the take-off spot, 7 m away. */
const athlete = standing({ x: 0.58 * W, floor: 498, stature: 255 });
/** Someone further back, off to the run-up side. */
const bystander = standing({ x: 200, floor: 420, stature: 170, facing: -1 });

type Device = { deviceId: string; label: string; facing: 'user' | 'environment'; zoomMin: number };
const WIDE: Device = { deviceId: 'wide', label: '后置相机', facing: 'environment', zoomMin: 1 };
const TRIPLE: Device = { deviceId: 'triple', label: '后置三镜头相机', facing: 'environment', zoomMin: 0.5 };
const FRONT: Device = { deviceId: 'front', label: '前置相机', facing: 'user', zoomMin: 1 };
const ULTRA: Device = { deviceId: 'ultra', label: '后置超广角相机', facing: 'environment', zoomMin: 1 };

class FakeTrack {
  stopped = false;
  constructor(readonly device: Device) {}
  get label() {
    return this.device.label;
  }
  getSettings() {
    return { deviceId: this.device.deviceId, facingMode: this.device.facing, frameRate: 60, width: W, height: H };
  }
  getCapabilities() {
    return { zoom: { min: this.device.zoomMin, max: 10 }, frameRate: { min: 1, max: 60 } };
  }
  stop() {
    this.stopped = true;
  }
  addEventListener() {}
}

class FakeStream {
  constructor(readonly track: FakeTrack) {}
  getTracks() {
    return [this.track];
  }
  getVideoTracks() {
    return [this.track];
  }
}

class FakeCameraVideo {
  videoWidth = 0;
  videoHeight = 0;
  readyState = 0;
  stream: FakeStream | null = null;
  constructor(public scene: () => { people: Pose[]; luma: (x: number, y: number) => number }) {}
  set srcObject(s: FakeStream) {
    this.stream = s;
  }
  async play() {
    this.videoWidth = W;
    this.videoHeight = H;
    this.readyState = 4;
  }
  get picture(): Picture {
    return { w: this.videoWidth, h: this.videoHeight, locked: false, ...this.scene() };
  }
}

class FakeRecorder {
  static made: FakeRecorder[] = [];
  static isTypeSupported(type: string) {
    return ['video/mp4;codecs=avc1', 'video/mp4'].includes(type);
  }
  state = 'inactive';
  mimeType = '';
  slice: number | null = null;
  ondataavailable: (e: { data: NodeBlob }) => void = () => {};
  onstart: () => void = () => {};
  onstop: () => void = () => {};
  onerror: () => void = () => {};
  /** What `stop` hands over last, as the browser does with what it hasn't yet. */
  tail: Uint8Array<ArrayBuffer> | null = null;
  constructor(
    readonly stream: FakeStream,
    readonly options: { mimeType?: string; videoBitsPerSecond?: number },
  ) {
    FakeRecorder.made.push(this);
  }
  start(slice: number) {
    this.slice = slice;
    this.state = 'recording';
    Promise.resolve().then(() => {
      // As in WebKit: the type is known once recording starts.
      this.mimeType = 'video/mp4; codecs="avc1.42000a"';
      this.onstart();
    });
  }
  emit(bytes: Uint8Array<ArrayBuffer>) {
    this.ondataavailable({ data: new NodeBlob([bytes]) });
  }
  stop() {
    this.state = 'inactive';
    Promise.resolve().then(() => {
      if (this.tail) this.emit(this.tail);
      this.onstop();
    });
  }
}

type Camera = Page & {
  video: FakeCameraVideo;
  opened: { constraints: { audio: boolean; video: Record<string, unknown> }; stream: FakeStream }[];
  /** Moves the page's clock on, running its timers as they come due. */
  advance: (ms: number) => Promise<void>;
  /** Everything the page has said of a type so far. */
  all: (type: string) => Record<string, any>[];
};

const flush = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r));
};

async function openCamera(
  o: { devices?: Device[]; denied?: boolean; noCamera?: boolean; noRecorder?: boolean; maxSeconds?: number; people?: () => Pose[] } = {},
): Promise<Camera> {
  const devices = o.devices ?? [FRONT, WIDE];
  const people = o.people ?? (() => [athlete, bystander]);
  const video = new FakeCameraVideo(() => {
    const now = people();
    return { people: now, luma: lit(now, 60, 150) };
  });
  const opened: Camera['opened'] = [];
  const mediaDevices = {
    async getUserMedia(constraints: Camera['opened'][0]['constraints']) {
      if (o.denied) throw Object.assign(new Error('The request is not allowed'), { name: 'NotAllowedError' });
      const v = constraints.video as { deviceId?: { exact: string }; facingMode?: { ideal: string } };
      // WebKit's choice for a back camera: the one of several lenses first.
      const device = v.deviceId ? devices.find((d) => d.deviceId === v.deviceId!.exact)! : [...devices].sort((a, b) => a.zoomMin - b.zoomMin).find((d) => d.facing === 'environment')!;
      const stream = new FakeStream(new FakeTrack(device));
      opened.push({ constraints, stream });
      return stream;
    },
    async enumerateDevices() {
      return devices.map((d) => ({ kind: 'videoinput', deviceId: d.deviceId, label: d.label }));
    },
  };
  let now = 0;
  const timers: { at: number; fn: () => void; id: number }[] = [];
  let ids = 0;
  const timer = (fn: () => void, ms: number) => {
    timers.push({ at: now + ms, fn, id: ++ids });
    return ids;
  };
  FakeRecorder.made = [];
  const page = runPage(poseCameraHtml({ bg: '#000', accent: '#f80', maxSeconds: o.maxSeconds }), {
    elements: { video, overlay: new FakeCanvas() },
    timer,
    globals: {
      navigator: o.noCamera ? {} : { mediaDevices },
      MediaRecorder: o.noRecorder ? undefined : FakeRecorder,
      clearTimeout: (id: number) => {
        const i = timers.findIndex((t) => t.id === id);
        if (i >= 0) timers.splice(i, 1);
      },
      Date: { now: () => now },
      btoa: (s: string) => Buffer.from(s, 'binary').toString('base64'),
    },
  });
  const advance = async (ms: number) => {
    const end = now + ms;
    await flush();
    for (;;) {
      timers.sort((a, b) => a.at - b.at || a.id - b.id);
      if (!timers.length || timers[0].at > end) break;
      const t = timers.shift()!;
      now = t.at;
      t.fn();
      await flush();
    }
    now = end;
  };
  const all = (type: string) => page.messages.filter((m) => m.type === type) as Record<string, any>[];
  await advance(0);
  return { ...page, video, opened, advance, all };
}

const hipOf = (p: Pose) => ({ x: (p[LM.leftHip].x + p[LM.rightHip].x) / 2, y: (p[LM.leftHip].y + p[LM.rightHip].y) / 2 });

describe('the camera page', () => {
  it('opens the back camera for 1280 × 720 at 60 frames a second, without sound', async () => {
    const cam = await openCamera();
    await cam.advance(200);
    expect(cam.opened[0].constraints).toEqual({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 60 } },
    });
    expect(cam.all('camera')).toEqual([{ type: 'camera', label: '后置相机', physical: true, fps: 60, maxFps: 60, width: W, height: H }]);
    expect(await cam.next('model')).toMatchObject({ delegate: 'GPU', source: 'local' });
  });

  it('swaps a back camera of several lenses for the single wide lens, which keeps one scale through a take', async () => {
    const cam = await openCamera({ devices: [FRONT, TRIPLE, WIDE, ULTRA] });
    await cam.advance(200);
    // The phone's names, shortest first: the front camera is tried and turned away by the way it faces.
    expect(cam.opened.map((o) => o.stream.track.device.deviceId)).toEqual(['triple', 'front', 'wide']);
    expect(cam.opened.map((o) => o.stream.track.stopped)).toEqual([true, true, false]);
    expect(cam.all('camera')[0]).toMatchObject({ label: '后置相机', physical: true });
  });

  it('keeps the camera of several lenses when no single lens opens, and says so', async () => {
    const cam = await openCamera({ devices: [FRONT, TRIPLE] });
    await cam.advance(200);
    expect(cam.all('camera')[0]).toMatchObject({ label: '后置三镜头相机', physical: false });
  });

  it('says why it can’t have the camera', async () => {
    const denied = await openCamera({ denied: true });
    expect(denied.all('error')).toEqual([expect.objectContaining({ stage: 'camera', name: 'NotAllowedError' })]);
    const none = await openCamera({ noCamera: true });
    expect(none.all('error')).toEqual([expect.objectContaining({ stage: 'camera', name: 'NotSupportedError' })]);
  });

  it('searches the whole picture, then reads around the biggest person, a few times a second', async () => {
    const cam = await openCamera();
    await cam.advance(1000);
    const frames = cam.all('frame');
    expect(frames.length).toBeGreaterThanOrEqual(5);
    const [first, second] = frames;
    // Everyone, found in squares across the picture; then only the athlete, read in a square around them.
    expect(first).toMatchObject({ width: W, height: H, crowd: 2 });
    expect(first.poses.map((v: number[]) => Math.round(hipOf(decodePose(v, W, H)).x)).sort((a: number, b: number) => a - b)).toEqual([200, 742]);
    expect(second.poses).toHaveLength(1);
    expect(second.crowd).toBe(2);
    decodePose(second.poses[0], W, H).forEach((l, i) => {
      expect(l.x).toBeCloseTo(athlete[i].x, 1);
      expect(l.y).toBeCloseTo(athlete[i].y, 1);
    });
  });

  it('measures how bright the picture is, and each person in it', async () => {
    const cam = await openCamera({ people: () => [athlete] });
    await cam.advance(300);
    const [f] = cam.all('frame');
    // The picture at 60, the athlete's box at 150, read on the picture shrunk to 64 px across.
    expect(f.luma).toBe(61);
    expect(f.lumas).toEqual([150]);
  });

  it('searches the whole picture again now and then, for whoever has come or gone', async () => {
    let people = [athlete, bystander];
    const cam = await openCamera({ people: () => people });
    await cam.advance(600);
    people = [athlete];
    await cam.advance(3000);
    const crowds = cam.all('frame').map((f) => f.crowd);
    expect(crowds[0]).toBe(2);
    expect(crowds[crowds.length - 1]).toBe(1);
  });

  it('records the take, sending it in pieces as the app writes each, and reads poses again after', async () => {
    const cam = await openCamera();
    await cam.advance(500);
    cam.win.startRecording();
    await cam.advance(0);
    const rec = FakeRecorder.made[0];
    expect(rec.options).toEqual({ mimeType: 'video/mp4;codecs=avc1', videoBitsPerSecond: CAMERA_BITRATE });
    // A slice a second: without one, iOS 26 and 27 stop putting video in the file after about 15 s.
    expect(rec.slice).toBe(1000);
    expect(cam.all('recording')).toEqual([{ type: 'recording', mime: 'video/mp4; codecs="avc1.42000a"' }]);

    // No reading while recording: the phone's GPU goes to the video.
    const before = cam.all('frame').length;
    await cam.advance(1000);
    expect(cam.all('frame')).toHaveLength(before);

    const bytes = Uint8Array.from({ length: 1_500_000 }, (_, i) => (i * 7919) % 251);
    rec.emit(bytes.slice(0, 1_200_000));
    await cam.advance(0);
    // One piece at a time: the next only once the app has written this one.
    expect(cam.all('chunk').map((c) => c.seq)).toEqual([0]);
    cam.win.ack(0);
    await cam.advance(0);
    expect(cam.all('chunk').map((c) => c.seq)).toEqual([0, 1]);
    rec.tail = bytes.slice(1_200_000);
    cam.win.stopRecording();
    await cam.advance(0);
    cam.win.ack(1);
    await cam.advance(0);
    cam.win.ack(2);
    await cam.advance(0);

    const chunks = cam.all('chunk');
    expect(chunks.every((c) => Buffer.from(c.data, 'base64').length <= CHUNK_BYTES)).toBe(true);
    expect(Buffer.concat(chunks.map((c) => Buffer.from(c.data, 'base64'))).equals(bytes)).toBe(true);
    expect(cam.all('recorded')).toEqual([{ type: 'recorded', chunks: 3, size: 1_500_000, mime: 'video/mp4; codecs="avc1.42000a"', seconds: 1 }]);

    await cam.advance(500);
    expect(cam.all('frame').length).toBeGreaterThan(before);
    expect(cam.all('error')).toEqual([]);
  });

  it('stops recording by itself after the longest take', async () => {
    const cam = await openCamera({ maxSeconds: 5 });
    await cam.advance(300);
    cam.win.startRecording();
    await cam.advance(4900);
    expect(FakeRecorder.made[0].state).toBe('recording');
    await cam.advance(200);
    expect(FakeRecorder.made[0].state).toBe('inactive');
    expect(cam.all('recorded')).toEqual([expect.objectContaining({ chunks: 0, size: 0, seconds: 5 })]);
  });

  it('says so when the phone can’t record in a web page', async () => {
    const cam = await openCamera({ noRecorder: true });
    await cam.advance(300);
    cam.win.startRecording();
    expect(cam.all('error')).toEqual([expect.objectContaining({ stage: 'record' })]);
  });
});
