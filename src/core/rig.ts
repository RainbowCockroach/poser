/*
 * Character profile -> rig: the bone tree in rest pose plus the segmented mannequin shapes.
 * A profile is the shareable ".oc.json" file: height in cm, proportions and build.
 * Units are meters, Y is up, the character faces +Z and its left side is +X.
 * Rest pose: standing, arms hanging, palms facing the thighs, thumbs forward. Every pose angle is 0 here.
 * Proportions follow a realistic 7.5-heads adult, then the profile multipliers stretch it
 * (chibi = few heads tall, long legs = legLength > 1). Height always comes out exact.
 * Pure data, no DOM: the web app, tests and the future CLI/MCP server all use this file.
 */

// #region Types
export type Vec3 = [number, number, number];

export interface CharacterProfile {
  format: 'poser.character/1';
  name: string;
  heightCm: number;
  color: string;
  proportions: Proportions;
  build: Build;
}

export interface Proportions {
  headsTall: number;
  neckLength: number;
  torsoLength: number;
  legLength: number;
  armLength: number;
  handSize: number;
  footSize: number;
  shoulderWidth: number;
  hipWidth: number;
}

export interface Build {
  weight: number;
  muscle: number;
  chest: number;
}

export type Shape =
  | { kind: 'capsule'; start: Vec3; end: Vec3; radiusStart: number; radiusEnd: number; squash?: Vec3 }
  | { kind: 'ellipsoid'; center: Vec3; radii: Vec3; isAccent?: boolean }
  | { kind: 'ball'; center: Vec3; radius: number };

export interface Bone {
  name: string;
  parent: string | null;
  offset: Vec3;
  restRotationDegrees?: Vec3;
  shapes: Shape[];
}

export interface Rig {
  profile: CharacterProfile;
  heightMeters: number;
  headHeight: number;
  bones: Bone[];
}
// #endregion

// #region Config
export const DEFAULT_PROFILE: CharacterProfile = {
  format: 'poser.character/1',
  name: 'Mannequin',
  heightCm: 170,
  color: '#d9c3a5',
  proportions: {
    headsTall: 7.5,
    neckLength: 1,
    torsoLength: 1,
    legLength: 1,
    armLength: 1,
    handSize: 1,
    footSize: 1,
    shoulderWidth: 1,
    hipWidth: 1,
  },
  build: { weight: 0, muscle: 0, chest: 0 },
};

// Realistic adult, measured in heads below the chin: legs to hip joint, hip joint to neck base, neck.
const STANDARD_LEG_HEADS = 3.9;
const STANDARD_TORSO_HEADS = 2.25;
const STANDARD_NECK_HEADS = 0.35;
const STANDARD_BELOW_CHIN_HEADS = 6.5;

// Finger knuckle position across the palm (fraction of palm width, + is the thumb side) and length (fraction of hand length).
const FINGERS = [
  { name: 'index', across: 0.375, length: 0.4 },
  { name: 'middle', across: 0.125, length: 0.44 },
  { name: 'ring', across: -0.125, length: 0.41 },
  { name: 'pinky', across: -0.375, length: 0.33 },
];
const PHALANX_SHARES = [0.45, 0.3, 0.25];
// #endregion

// #region Main flow
export function buildRig(input: CharacterProfile): Rig {
  const profile = normalizeProfile(input);
  const proportions = profile.proportions;
  const build = profile.build;

  const height = profile.heightCm / 100;
  const head = height / proportions.headsTall;
  const belowChin = height - head;
  const legWeight = STANDARD_LEG_HEADS * proportions.legLength;
  const torsoWeight = STANDARD_TORSO_HEADS * proportions.torsoLength;
  const neckWeight = STANDARD_NECK_HEADS * proportions.neckLength;
  const weightSum = legWeight + torsoWeight + neckWeight;
  const leg = (belowChin * legWeight) / weightSum;
  const torso = (belowChin * torsoWeight) / weightSum;
  const neck = (belowChin * neckWeight) / weightSum;
  // Body unit: the head size this body would have with realistic proportions. Widths scale with it, so a chibi keeps a small body under a big head.
  const unit = belowChin / STANDARD_BELOW_CHIN_HEADS;
  // Stylized short characters read better with stockier limbs and torso than a scaled-down realistic body.
  const thickness = unit * (1 + 0.09 * Math.max(0, 7.5 - proportions.headsTall));

  const fat = build.weight;
  const fatWidth = 1 + (fat > 0 ? 0.35 : 0.2) * fat;
  const fatDepth = 1 + (fat > 0 ? 0.5 : 0.25) * fat;
  const bellyDepth = 1 + (fat > 0 ? 0.75 : 0.25) * fat;
  const limbThickness = (1 + (fat > 0 ? 0.45 : 0.3) * fat) * (1 + 0.25 * build.muscle);
  const thighThickness = (1 + (fat > 0 ? 0.65 : 0.3) * fat) * (1 + 0.25 * build.muscle);
  const chestWidth = fatWidth * (1 + 0.15 * build.muscle);

  const upperArm = 1.3 * unit * proportions.armLength;
  const forearm = 1.15 * unit * proportions.armLength;
  const handLength = 0.8 * unit * proportions.handSize;
  const palmWidth = 0.45 * handLength;
  const upperArmRadius = 0.2 * thickness * limbThickness;
  const fingerRadius = 0.1 * palmWidth;

  const footLength = 1.1 * unit * proportions.footSize;
  const ankleHeight = 0.3 * unit;
  const thigh = (leg - ankleHeight) * 0.53;
  const shin = (leg - ankleHeight) * 0.47;
  const thighRadius = 0.36 * thickness * thighThickness;
  const footSquash = 0.55;
  const toeJointHeight = -ankleHeight + 0.19 * footLength * footSquash;

  const shoulderHalfWidth = 0.72 * unit * proportions.shoulderWidth * (1 + 0.1 * build.muscle);
  const hipJointHalfWidth = 0.4 * unit * proportions.hipWidth * (1 + 0.25 * Math.max(0, fat));

  const left: Bone[] = [];
  const bones: Bone[] = [
    {
      name: 'pelvis',
      parent: null,
      offset: [0, leg + 0.1 * torso, 0],
      shapes: [{ kind: 'ellipsoid', center: [0, -0.02 * torso, 0], radii: [0.66 * thickness * proportions.hipWidth * fatWidth, 0.2 * torso, 0.46 * thickness * fatDepth] }],
    },
    {
      name: 'lumbar_lower',
      parent: 'pelvis',
      offset: [0, 0.1 * torso, 0],
      shapes: [{ kind: 'ellipsoid', center: [0, 0.06 * torso, 0], radii: [0.5 * thickness * fatWidth, 0.13 * torso, 0.36 * thickness * bellyDepth] }],
    },
    {
      name: 'lumbar_upper',
      parent: 'lumbar_lower',
      offset: [0, 0.16 * torso, 0],
      shapes: [{ kind: 'ellipsoid', center: [0, 0.06 * torso, 0.01 * thickness], radii: [0.52 * thickness * fatWidth, 0.13 * torso, 0.38 * thickness * bellyDepth] }],
    },
    {
      name: 'thoracic_lower',
      parent: 'lumbar_upper',
      offset: [0, 0.16 * torso, 0],
      shapes: [{ kind: 'ellipsoid', center: [0, 0.04 * torso, 0], radii: [0.55 * thickness * chestWidth, 0.12 * torso, 0.4 * thickness * fatDepth] }],
    },
    {
      name: 'thoracic_upper',
      parent: 'thoracic_lower',
      offset: [0, 0.2 * torso, 0],
      shapes: [{ kind: 'ellipsoid', center: [0, 0.03 * torso, 0], radii: [0.66 * thickness * chestWidth, 0.25 * torso, 0.44 * thickness * fatDepth] }],
    },
    {
      name: 'neck',
      parent: 'thoracic_upper',
      offset: [0, 0.28 * torso, -0.03 * unit],
      shapes: [{ kind: 'capsule', start: [0, 0, 0], end: [0, neck + 0.2 * head, 0], radiusStart: 0.26 * thickness * fatWidth, radiusEnd: 0.22 * thickness * fatWidth }],
    },
    {
      name: 'head',
      parent: 'neck',
      offset: [0, neck + 0.2 * head, 0.03 * unit],
      shapes: [
        { kind: 'ellipsoid', center: [0, 0.38 * head, 0], radii: [0.37 * head, 0.42 * head, 0.45 * head] },
        { kind: 'ellipsoid', center: [0, 0.08 * head, 0.1 * head], radii: [0.3 * head, 0.28 * head, 0.33 * head] },
        { kind: 'ellipsoid', center: [0, 0.2 * head, 0.42 * head], radii: [0.06 * head, 0.09 * head, 0.07 * head], isAccent: true },
        { kind: 'ellipsoid', center: [0.14 * head, 0.34 * head, 0.39 * head], radii: [0.06 * head, 0.04 * head, 0.04 * head], isAccent: true },
        { kind: 'ellipsoid', center: [-0.14 * head, 0.34 * head, 0.39 * head], radii: [0.06 * head, 0.04 * head, 0.04 * head], isAccent: true },
      ],
    },
  ];

  if (build.chest > 0) {
    const breastRadius = 0.25 * thickness * (0.4 + build.chest) * Math.sqrt(fatWidth);
    const thoracicUpper = bones.find((bone) => bone.name === 'thoracic_upper')!;
    for (const side of [1, -1]) {
      thoracicUpper.shapes.push({
        kind: 'ellipsoid',
        center: [side * 0.28 * thickness * chestWidth, 0, 0.3 * thickness * fatDepth],
        radii: [breastRadius, breastRadius * 0.9, breastRadius * 0.85],
      });
    }
  }

  left.push(
    {
      name: 'clavicle_l',
      parent: 'thoracic_upper',
      offset: [0.05 * unit, 0.2 * torso, 0.12 * unit],
      shapes: [{ kind: 'capsule', start: [0, 0, 0], end: [shoulderHalfWidth - 0.05 * unit, 0, -0.12 * unit], radiusStart: 0.08 * unit, radiusEnd: 0.1 * unit }],
    },
    {
      name: 'shoulder_l',
      parent: 'clavicle_l',
      offset: [shoulderHalfWidth - 0.05 * unit, 0, -0.12 * unit],
      shapes: [
        { kind: 'ball', center: [0, 0, 0], radius: upperArmRadius * 1.1 },
        { kind: 'capsule', start: [0, 0, 0], end: [0, -upperArm, 0], radiusStart: upperArmRadius, radiusEnd: upperArmRadius * 0.8 },
      ],
    },
    {
      name: 'elbow_l',
      parent: 'shoulder_l',
      offset: [0, -upperArm, 0],
      shapes: [
        { kind: 'ball', center: [0, 0, 0], radius: upperArmRadius * 0.78 },
        { kind: 'capsule', start: [0, 0, 0], end: [0, -forearm, 0], radiusStart: upperArmRadius * 0.8, radiusEnd: upperArmRadius * 0.55 },
      ],
    },
    {
      name: 'wrist_l',
      parent: 'elbow_l',
      offset: [0, -forearm, 0],
      shapes: [
        { kind: 'ball', center: [0, 0, 0], radius: upperArmRadius * 0.5 },
        { kind: 'capsule', start: [0, -0.05 * handLength, 0], end: [0, -0.5 * handLength, 0], radiusStart: palmWidth * 0.42, radiusEnd: palmWidth * 0.5, squash: [0.45, 1, 1] },
      ],
    },
  );

  for (const finger of FINGERS) {
    const fingerLength = finger.length * handLength;
    const knuckleHeight = finger.name === 'pinky' ? -0.52 * handLength : -0.56 * handLength;
    let parent = 'wrist_l';
    let offset: Vec3 = [0, knuckleHeight, finger.across * palmWidth];
    for (let index = 0; index < 3; index++) {
      const phalanx = PHALANX_SHARES[index] * fingerLength;
      const radius = fingerRadius * (1 - 0.12 * index);
      const name = `${finger.name}_${index + 1}_l`;
      left.push({
        name,
        parent,
        offset,
        shapes: [
          { kind: 'ball', center: [0, 0, 0], radius: radius * 1.08 },
          { kind: 'capsule', start: [0, 0, 0], end: [0, -phalanx, 0], radiusStart: radius, radiusEnd: radius * 0.9 },
        ],
      });
      parent = name;
      offset = [0, -phalanx, 0];
    }
  }

  const thumbLengths = [0.25, 0.18, 0.15].map((share) => share * handLength);
  left.push(
    {
      name: 'thumb_1_l',
      parent: 'wrist_l',
      offset: [-0.08 * palmWidth, -0.12 * handLength, 0.3 * palmWidth],
      restRotationDegrees: [-40, 0, -15],
      shapes: [{ kind: 'capsule', start: [0, 0, 0], end: [0, -thumbLengths[0], 0], radiusStart: fingerRadius * 1.5, radiusEnd: fingerRadius * 1.2 }],
    },
    {
      name: 'thumb_2_l',
      parent: 'thumb_1_l',
      offset: [0, -thumbLengths[0], 0],
      shapes: [
        { kind: 'ball', center: [0, 0, 0], radius: fingerRadius * 1.2 },
        { kind: 'capsule', start: [0, 0, 0], end: [0, -thumbLengths[1], 0], radiusStart: fingerRadius * 1.15, radiusEnd: fingerRadius * 1.05 },
      ],
    },
    {
      name: 'thumb_3_l',
      parent: 'thumb_2_l',
      offset: [0, -thumbLengths[1], 0],
      shapes: [
        { kind: 'ball', center: [0, 0, 0], radius: fingerRadius * 1.1 },
        { kind: 'capsule', start: [0, 0, 0], end: [0, -thumbLengths[2], 0], radiusStart: fingerRadius * 1.05, radiusEnd: fingerRadius * 0.95 },
      ],
    },
  );

  left.push(
    {
      name: 'hip_l',
      parent: 'pelvis',
      offset: [hipJointHalfWidth, -0.1 * torso, 0],
      shapes: [
        { kind: 'ball', center: [0, 0, 0], radius: thighRadius * 0.95 },
        { kind: 'capsule', start: [0, 0, 0], end: [0, -thigh, 0], radiusStart: thighRadius, radiusEnd: thighRadius * 0.66 },
      ],
    },
    {
      name: 'knee_l',
      parent: 'hip_l',
      offset: [0, -thigh, 0],
      shapes: [
        { kind: 'ball', center: [0, 0, 0], radius: thighRadius * 0.64 },
        { kind: 'capsule', start: [0, 0, 0], end: [0, -shin, 0], radiusStart: thighRadius * 0.66, radiusEnd: thighRadius * 0.4 },
      ],
    },
    {
      name: 'ankle_l',
      parent: 'knee_l',
      offset: [0, -shin, 0],
      shapes: [
        { kind: 'ball', center: [0, 0, 0], radius: thighRadius * 0.4 },
        {
          kind: 'capsule',
          start: [0, -ankleHeight + 0.17 * footLength * footSquash, -0.18 * footLength],
          end: [0, toeJointHeight, 0.58 * footLength],
          radiusStart: 0.17 * footLength,
          radiusEnd: 0.19 * footLength,
          squash: [1, footSquash, 1],
        },
      ],
    },
    {
      name: 'toes_l',
      parent: 'ankle_l',
      offset: [0, toeJointHeight, 0.58 * footLength],
      shapes: [{ kind: 'capsule', start: [0, 0, 0], end: [0, 0, 0.2 * footLength], radiusStart: 0.18 * footLength, radiusEnd: 0.13 * footLength, squash: [1, 0.5, 1] }],
    },
  );

  bones.push(...left, ...left.map(mirrorBone));
  return { profile, heightMeters: height, headHeight: head, bones };
}
// #endregion

// #region Helpers
export function normalizeProfile(input: Partial<CharacterProfile>): CharacterProfile {
  return {
    ...DEFAULT_PROFILE,
    ...input,
    format: 'poser.character/1',
    proportions: { ...DEFAULT_PROFILE.proportions, ...input.proportions },
    build: { ...DEFAULT_PROFILE.build, ...input.build },
  };
}

function mirrorBone(bone: Bone): Bone {
  const flipX = (vector: Vec3): Vec3 => [-vector[0], vector[1], vector[2]];
  const rename = (name: string) => name.replace(/_l$/, '_r');
  return {
    name: rename(bone.name),
    parent: bone.parent && rename(bone.parent),
    offset: flipX(bone.offset),
    // A mirrored rotation keeps its X component and flips Y and Z.
    restRotationDegrees: bone.restRotationDegrees && [bone.restRotationDegrees[0], -bone.restRotationDegrees[1], -bone.restRotationDegrees[2]],
    shapes: bone.shapes.map((shape): Shape => {
      if (shape.kind === 'capsule') return { ...shape, start: flipX(shape.start), end: flipX(shape.end) };
      return { ...shape, center: flipX(shape.center) };
    }),
  };
}
// #endregion
