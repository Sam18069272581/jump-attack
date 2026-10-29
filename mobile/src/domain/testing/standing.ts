import { LANDMARK_COUNT, LM, SIDE, type Pose } from '../pose';

export type Stand = {
  /** Mid-hip, picture px. */
  x: number;
  /** Where the feet meet the floor, picture px. */
  floor: number;
  /** Floor to the top of the head, px. */
  stature: number;
  /** +1: toes point right (runs left to right); −1: toes point left. */
  facing?: 1 | -1;
  /** Turned this far from side-on, degrees: 0 is side-on, 90 faces the phone. */
  yaw?: number;
  /** The pose model's visibility for every point, and for the feet. */
  vis?: number;
  footVis?: number;
};

/**
 * A person standing still, as the pose model would report them, with Drillis and Contini's proportions (Winter,
 * "Biomechanics and Motor Control of Human Movement", fig. 4.1), heights as shares of stature: ear 0.93, shoulder
 * 0.818, elbow 0.63, wrist 0.485, hip 0.53, knee 0.285, ankle 0.039; the foot 0.152 long.
 */
export function standing({ x, floor, stature: S, facing = 1, yaw = 0, vis = 0.95, footVis = vis }: Stand): Pose {
  const p: Pose = Array.from({ length: LANDMARK_COUNT }, () => ({ x, y: floor - 0.93 * S, z: 0, v: vis }));
  const at = (share: number) => floor - share * S;
  // Left and right sit apart in the picture by how far the body is turned.
  const apart = Math.sin((yaw * Math.PI) / 180);
  const half = { shoulder: 0.1, hip: 0.07, knee: 0.05, ankle: 0.05 };
  for (const [side, sign] of [['left', -1], ['right', 1]] as const) {
    const k = SIDE[side];
    const off = (w: number) => x + sign * w * S * apart;
    p[k.shoulder] = { x: off(half.shoulder), y: at(0.818), z: 0, v: vis };
    p[k.elbow] = { x: off(half.shoulder), y: at(0.63), z: 0, v: vis };
    p[k.wrist] = { x: off(half.shoulder), y: at(0.485), z: 0, v: vis };
    p[k.index] = { x: off(half.shoulder), y: at(0.43), z: 0, v: vis };
    p[k.pinky] = { x: off(half.shoulder), y: at(0.43), z: 0, v: vis };
    p[k.hip] = { x: off(half.hip), y: at(0.53), z: 0, v: vis };
    p[k.knee] = { x: off(half.knee), y: at(0.285), z: 0, v: vis };
    p[k.ankle] = { x: off(half.ankle), y: at(0.039), z: 0, v: footVis };
    p[k.heel] = { x: off(half.ankle) - facing * 0.04 * S, y: floor, z: 0, v: footVis };
    p[k.toe] = { x: off(half.ankle) + facing * 0.112 * S, y: floor, z: 0, v: footVis };
  }
  p[LM.leftEar] = { x, y: at(0.93), z: 0, v: vis };
  p[LM.rightEar] = { x, y: at(0.93), z: 0, v: vis };
  p[LM.nose] = { x: x + facing * 0.05 * S, y: at(0.93), z: 0, v: vis };
  return p;
}
