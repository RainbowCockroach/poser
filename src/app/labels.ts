/*
 * Plain words for the joint sliders. Files, the CLI and the core keep the anatomical names ("abduction");
 * the app shows what an artist sees happen ("Arm out to the side"), with a word at each end of the slider.
 * Keys are a control name without its side ("shoulder") and a motion name from core/pose.ts.
 */

// #region Config
interface MotionWords {
  label: string;
  low: string;
  high: string;
}

const PART_NAMES: Record<string, string> = {
  pelvis: 'Hips (whole body)',
  lumbar: 'Waist',
  thoracic: 'Chest',
  neck: 'Head and neck',
  shoulder_girdle: 'shoulder (shrug)',
  shoulder: 'upper arm',
  elbow: 'elbow and forearm',
  wrist: 'hand',
  thumb: 'thumb',
  index: 'index finger',
  middle: 'middle finger',
  ring: 'ring finger',
  pinky: 'pinky',
  hip: 'thigh',
  knee: 'knee',
  ankle: 'foot',
  toes: 'toes',
};

const SPINE_WORDS: Record<string, MotionWords> = {
  flexion: { label: 'Bend forward', low: 'back', high: 'forward' },
  side_bend: { label: 'Bend sideways', low: 'to its right', high: 'to its left' },
  rotation: { label: 'Twist', low: 'to its right', high: 'to its left' },
};

const FINGER_WORDS: Record<string, MotionWords> = {
  base_flexion: { label: 'Curl at the knuckle', low: 'back', high: 'curled' },
  spread: { label: 'Spread', low: 'together', high: 'apart' },
  middle_flexion: { label: 'Curl the finger', low: 'straight', high: 'curled' },
};

const MOTION_WORDS: Record<string, Record<string, MotionWords>> = {
  pelvis: {
    turn: { label: 'Turn around', low: 'to its right', high: 'to its left' },
    forward_tilt: { label: 'Lean the whole body', low: 'back', high: 'forward' },
    side_tilt: { label: 'Tip the whole body', low: 'to its right', high: 'to its left' },
  },
  lumbar: SPINE_WORDS,
  thoracic: SPINE_WORDS,
  neck: {
    flexion: { label: 'Nod', low: 'look up', high: 'look down' },
    side_bend: { label: 'Tilt the head', low: 'to its right', high: 'to its left' },
    rotation: { label: 'Turn the head', low: 'to its right', high: 'to its left' },
  },
  shoulder_girdle: {
    elevation: { label: 'Shrug', low: 'down', high: 'up' },
    protraction: { label: 'Shoulder forward', low: 'back', high: 'forward' },
  },
  shoulder: {
    flexion: { label: 'Arm forward', low: 'back', high: 'forward, up' },
    abduction: { label: 'Arm out to the side', low: 'across', high: 'out, up' },
    internal_rotation: { label: 'Twist the arm', low: 'outward', high: 'inward' },
  },
  elbow: {
    flexion: { label: 'Bend the elbow', low: 'straight', high: 'bent' },
    pronation: { label: 'Turn the palm', low: 'forward, up', high: 'back, down' },
  },
  wrist: {
    flexion: { label: 'Bend the wrist', low: 'back', high: 'toward palm' },
    radial_deviation: { label: 'Tilt the hand', low: 'toward pinky', high: 'toward thumb' },
  },
  thumb: {
    cmc_flexion: { label: 'Thumb across the palm', low: 'out to the side', high: 'across' },
    cmc_abduction: { label: 'Thumb away from the palm', low: 'flat', high: 'away' },
    cmc_opposition: { label: 'Turn the thumb to face the fingers', low: 'away', high: 'facing' },
    mcp_flexion: { label: 'Curl the thumb', low: 'straight', high: 'curled' },
    ip_flexion: { label: 'Curl the thumb tip', low: 'back', high: 'curled' },
  },
  index: FINGER_WORDS,
  middle: FINGER_WORDS,
  ring: FINGER_WORDS,
  pinky: FINGER_WORDS,
  hip: {
    flexion: { label: 'Leg forward', low: 'back', high: 'forward, up' },
    abduction: { label: 'Leg out to the side', low: 'across', high: 'out' },
    internal_rotation: { label: 'Twist the leg', low: 'toes out', high: 'toes in' },
  },
  knee: {
    flexion: { label: 'Bend the knee', low: 'straight', high: 'bent' },
  },
  ankle: {
    dorsiflexion: { label: 'Point or flex the foot', low: 'pointed', high: 'toes up' },
    inversion: { label: 'Roll the foot', low: 'sole out', high: 'sole in' },
  },
  toes: {
    flexion: { label: 'Curl the toes', low: 'up', high: 'down' },
  },
};
// #endregion

// #region Main flow
export function partName(controlName: string): string {
  const side = controlName.match(/_(l|r)$/)?.[1];
  const name = PART_NAMES[controlName.replace(/_(l|r)$/, '')] ?? controlName.replace(/_/g, ' ');
  if (!side) return name;
  return `${side === 'l' ? 'Left' : 'Right'} ${name}`;
}

export function motionWords(controlName: string, motionName: string): MotionWords {
  return MOTION_WORDS[controlName.replace(/_(l|r)$/, '')]?.[motionName] ?? { label: motionName.replace(/_/g, ' '), low: '', high: '' };
}
// #endregion
