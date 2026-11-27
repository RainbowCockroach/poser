/*
 * Poser app shell: the 3D stage on the left (or top on phones) and the edit panel.
 * Scene state lives here: the characters (each a profile and a pose), the props, the lights, the background, saved
 * camera views, plus undo history. The camera itself (position, lens) belongs to the stage and is read when saving.
 * Scenes and characters are saved as JSON files ("poser.scene/1", "poser.character/1") to share.
 * "Save PNG" re-renders the current view without the editing helpers (grid, ruler, light markers).
 * Run: npm run dev
 */

// #region Setup
import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { Grid, Html, OrbitControls, OrthographicCamera, PerspectiveCamera } from '@react-three/drei';
import { Box3, MOUSE, PerspectiveCamera as ThreePerspectiveCamera, SRGBColorSpace, TextureLoader, Vector2, Vector3, type Texture } from 'three';
import { Mannequin } from './Mannequin';
import { Panel, type Mode, type ViewName } from './Panel';
import { partName } from './labels';
import { Help } from './Help';
import { SceneLights } from './SceneLights';
import { buildRig, normalizeProfile, type CharacterProfile } from '../core/rig';
import { CONTROL_FOR_BONE, CONTROLS, copyLimbToOtherSide, forwardKinematics, mirrorPose, solvePose, type Pose } from '../core/pose';
import { dropToFloor, type Pin } from '../core/reach';
import { BODY_PARTS, findOverlaps, separate, touch } from '../core/body';
import { DEFAULT_LIGHTS, type SceneLight } from '../core/lights';
import { pinOfBone, useDragPosing, type TouchTarget } from './useDragPosing';
import { Guide } from './Guide';
import { Handles } from './Handles';
import { PropMeshes, type PropEntry } from './Props';
import { propBoxes, type SceneProp } from '../core/props';
import { DEFAULT_LENS_MM, distanceForLens, fieldOfViewDegrees, type CameraView } from '../core/camera';
import type { Vec3 } from '../core/rig';
// #endregion

// #region Types and config
export interface SceneCharacter {
  id: string;
  profile: CharacterProfile;
  pose: Pose;
  reference?: { url: string; opacity: number };
}

export interface LightEntry extends SceneLight {
  id: string;
}

export interface SceneState {
  characters: SceneCharacter[];
  sceneProps: PropEntry[];
  lights: LightEntry[];
  background: string;
  views: CameraView[];
}

export interface SceneFile {
  format: 'poser.scene/1';
  characters: { profile: CharacterProfile; pose: Pose }[];
  props?: SceneProp[];
  lights?: SceneLight[];
  background?: string;
  camera?: CameraView;
  views?: CameraView[];
}

export interface ExportRequest {
  scale: number;
  isTransparent: boolean;
  isShowingGuides: boolean;
}

const SAMPLE_PROFILES = Object.values(
  import.meta.glob('../../characters/*.oc.json', { eager: true, import: 'default' }),
) as CharacterProfile[];

export const DEFAULT_BACKGROUND = '#eef0f5';
const CHARACTER_SPACING = 0.9;
const RULER_HEIGHT_METERS = 2.5;
const UNDO_STEPS = 100;
// Changes with the same key closer together than this are one undo step (one slider drag).
const SAME_GESTURE_MILLISECONDS = 800;
// Big renders can fail on phones; the long side of a PNG stays under this.
const MAX_EXPORT_PIXELS = 4096;
const DOUBLE_CLICK_MILLISECONDS = 350;
// A closer look never goes nearer than this around a part, and leaves this much air around what it frames.
const MIN_FRAME_RADIUS = 0.12;
const FRAME_MARGIN = 0.08;
const THREE_QUARTER_DEGREES = 35;
const PENCIL_ONLY_STORAGE_KEY = 'poser.pencilOnly';
// The click a lifted finger makes arrives within this long after it lifts.
const MENU_SETTLE_MILLISECONDS = 350;
// Overlaps are checked this long after the last change, not on every frame of a drag.
const OVERLAP_CHECK_MILLISECONDS = 400;
// On screens wider than phones the mode rail and the card float over the stage; these match styles.css (rail and card plus gaps).
const WIDE_STAGE_PIXELS = 760;
const RAIL_SPACE_PIXELS = 94;
const CARD_SPACE_PIXELS = 340;
// Safari and every iPhone/iPad browser (WebKit) put the whole scene in shadow with PCF shadow maps; variance shadow maps work there.
// three.js can't do variance shadows for lamps (point lights), so lamps cast no shadow on those browsers.
export const SHADOW_TYPE = /AppleWebKit/.test(navigator.userAgent) && !/Chrome|Android/.test(navigator.userAgent) ? 'variance' : 'percentage';
// #endregion

// #region Main flow
export function App() {
  const [scene, setScene] = useState(() => ({
    present: {
      characters: [...SAMPLE_PROFILES]
        .sort((a, b) => b.heightCm - a.heightCm)
        .map((profile, index, all): SceneCharacter => ({
          id: newCharacterId(),
          profile: normalizeProfile(profile),
          pose: { position: [(index - (all.length - 1) / 2) * CHARACTER_SPACING, 0, 0] },
        })),
      sceneProps: [],
      lights: DEFAULT_LIGHTS.map((light) => ({ ...light, id: newLightId() })),
      background: DEFAULT_BACKGROUND,
      views: [],
    } as SceneState,
    past: [] as SceneState[],
    future: [] as SceneState[],
  }));
  const { characters, sceneProps, lights, background, views } = scene.present;
  const lastChange = useRef({ key: '', time: 0 });
  const [selectedId, setSelectedId] = useState<string | null>(() => characters[0]?.id ?? null);
  const [selectedControl, setSelectedControl] = useState<string | null>(null);
  const [selectedLightId, setSelectedLightId] = useState<string | null>(null);
  const [selectedPropId, setSelectedPropId] = useState<string | null>(null);
  const [isFrontView, setIsFrontView] = useState(false);
  // Pinned hands and feet per character; part of the editing, not of the scene file.
  const [pins, setPins] = useState<Record<string, Pin[]>>({});
  const [touchTarget, setTouchTarget] = useState<TouchTarget | null>(null);
  const [touchMessage, setTouchMessage] = useState('');
  const [overlapCount, setOverlapCount] = useState(0);
  const [isPencilOnly, setIsPencilOnly] = useState(() => {
    try {
      return localStorage.getItem(PENCIL_ONLY_STORAGE_KEY) === 'yes';
    } catch {
      return false;
    }
  });
  const [partMenu, setPartMenu] = useState<{ characterId: string; bone: string; clientX: number; clientY: number } | null>(null);
  // After a long press the finger is still down; the click from lifting it must not close the menu it just opened.
  const isMenuWaitingForRelease = useRef(false);
  const [exportRequest, setExportRequest] = useState<ExportRequest | null>(null);
  const [sceneVersion, setSceneVersion] = useState(0);
  const [lensMm, setLensMm] = useState(DEFAULT_LENS_MM);
  const [cameraJump, setCameraJump] = useState<CameraView | null>(null);
  // The 3D camera as the user left it, kept up to date by the stage without re-rendering, for saving and "Save this view".
  const cameraView = useRef<CameraView | null>(null);

  const goToView = (view: CameraView) => {
    setIsFrontView(false);
    setLensMm(view.lensMm);
    setCameraJump(view);
  };

  const [mode, setMode] = useState<Mode>('pose');
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [isCleanView, setIsCleanView] = useState(false);
  const [isCardFolded, setIsCardFolded] = useState(false);
  const stageElement = useRef<HTMLDivElement>(null);
  const lastMissedClick = useRef(0);

  // Moves the camera until these points fill the stage, from the direction given or the one it is looking from now.
  const frame = (points: Vector3[], towardCamera?: Vector3) => {
    if (points.length === 0) return;
    const center = new Box3().setFromPoints(points).getCenter(new Vector3());
    const radius = Math.max(MIN_FRAME_RADIUS, ...points.map((point) => point.distanceTo(center))) + FRAME_MARGIN;
    const current = cameraView.current;
    const direction = towardCamera ?? (current ? new Vector3(...current.position).sub(new Vector3(...current.target)).normalize() : new Vector3(0.1, 0.2, 1).normalize());
    const stageWidth = stageElement.current?.clientWidth ?? 1;
    const stageHeight = stageElement.current?.clientHeight ?? 1;
    const isWide = stageWidth > WIDE_STAGE_PIXELS && !isCleanView;
    const freeWidth = isWide ? stageWidth - RAIL_SPACE_PIXELS - (isCardFolded ? 0 : CARD_SPACE_PIXELS) : stageWidth;
    const halfVertical = (fieldOfViewDegrees(lensMm) * Math.PI) / 360;
    const halfHorizontal = Math.atan(Math.tan(halfVertical) * (freeWidth / Math.max(1, stageHeight)));
    const distance = radius / Math.sin(Math.min(halfVertical, halfHorizontal));
    goToView({ position: center.clone().addScaledVector(direction, distance).toArray(), target: center.toArray(), lensMm });
  };

  const bonePoints = (character: SceneCharacter, isWanted: (bone: string) => boolean = () => true) => {
    const rig = buildRig(character.profile);
    const world = forwardKinematics(rig, solvePose(character.pose));
    const points = rig.bones.filter((bone) => isWanted(bone.name)).map((bone) => world[bone.name].position);
    // The head bone sits at the base of the skull; without its top a framed character loses its crown.
    if (isWanted('head')) {
      const headHeight = character.profile.heightCm / 100 / character.profile.proportions.headsTall;
      points.push(new Vector3(0, headHeight, 0).applyQuaternion(world.head.quaternion).add(world.head.position));
    }
    return points;
  };

  // A part's joint, plus what hangs from it: the next joint down, or every finger for a hand.
  const lookCloser = (character: SceneCharacter, controlName: string) => {
    const rig = buildRig(character.profile);
    const own = new Set(Object.values(CONTROLS[controlName].motions).flatMap((motion) => motion.bones.map(([bone]) => bone)));
    const isHand = controlName.startsWith('wrist_');
    const wanted = new Set(own);
    for (const bone of rig.bones) {
      if (bone.parent && (own.has(bone.parent) || (isHand && wanted.has(bone.parent)))) wanted.add(bone.name);
    }
    frame(bonePoints(character, (bone) => wanted.has(bone)));
  };

  const changeScene = (update: (state: SceneState) => SceneState, key: string) => {
    const now = performance.now();
    // A body drag has its own key, so holding still mid-drag doesn't split it into two undo steps.
    const isSameGesture = key === lastChange.current.key && (key.startsWith('drag:') || now - lastChange.current.time < SAME_GESTURE_MILLISECONDS);
    lastChange.current = { key, time: now };
    setScene((current) => ({
      present: update(current.present),
      past: isSameGesture ? current.past : [...current.past.slice(-UNDO_STEPS), current.present],
      future: [],
    }));
  };
  const changeCharacters = (update: (list: SceneCharacter[]) => SceneCharacter[], key: string) =>
    changeScene((state) => ({ ...state, characters: update(state.characters) }), key);

  // Reference images are local blob URLs, not part of the scene, so undo keeps whatever image is showing now.
  const travel = (direction: 'undo' | 'redo') => {
    lastChange.current = { key: '', time: 0 };
    setScene((current) => {
      const source = direction === 'undo' ? current.past : current.future;
      if (source.length === 0) return current;
      const target = direction === 'undo' ? source[source.length - 1] : source[0];
      const restored: SceneState = {
        ...target,
        characters: target.characters.map((character) => ({ ...character, reference: current.present.characters.find((now) => now.id === character.id)?.reference })),
      };
      if (direction === 'undo') return { present: restored, past: current.past.slice(0, -1), future: [current.present, ...current.future] };
      return { present: restored, past: [...current.past, current.present], future: current.future.slice(1) };
    });
  };

  const selected = characters.find((character) => character.id === selectedId) ?? null;
  const selectedPins = selected ? (pins[selected.id] ?? []) : [];
  const latestCharacters = useRef(characters);
  latestCharacters.current = characters;

  // A whole-body lean can take a second or more on a phone; the message shows before the page is busy.
  const touchOnDrop = (character: SceneCharacter, part: string, target: TouchTarget) => {
    const targetName = BODY_PARTS[target.part]?.label.toLowerCase() ?? target.part;
    console.log(`Touch on drop: ${character.profile.name} ${part} → ${target.part} (${target.bone})`);
    setTouchMessage(`Touching the ${targetName}…`);
    setTimeout(() => {
      const list = latestCharacters.current.map((entry) => (entry.id === character.id ? character : entry));
      const posed = list.map((entry) => ({ name: entry.profile.name, rig: buildRig(entry.profile), pose: entry.pose }));
      const index = list.findIndex((entry) => entry.id === character.id);
      const targetIndex = list.findIndex((entry) => entry.id === target.characterId);
      try {
        const touched = touch(posed, index, part, targetIndex, target.part);
        updateCharacter(character.id, { pose: touched.pose }, 'touch');
        const gap = Math.round(Math.abs(touched.gapMeters) * 100);
        setTouchMessage(gap < 1 ? '' : `Got within ${gap} cm of the ${targetName}; the joints can't reach further.`);
      } catch (error) {
        setTouchMessage((error as Error).message);
      }
    }, 30);
  };

  useEffect(() => {
    if (!touchMessage || touchMessage.endsWith('…')) return;
    const timer = setTimeout(() => setTouchMessage(''), 4000);
    return () => clearTimeout(timer);
  }, [touchMessage]);

  useEffect(() => {
    if (!selected) return setOverlapCount(0);
    const timer = setTimeout(() => {
      const posed = characters.map((entry) => ({ name: entry.profile.name, rig: buildRig(entry.profile), pose: entry.pose }));
      const index = characters.findIndex((entry) => entry.id === selected.id);
      setOverlapCount(findOverlaps(posed).filter((overlap) => overlap.character === index || overlap.otherCharacter === index).length);
    }, OVERLAP_CHECK_MILLISECONDS);
    return () => clearTimeout(timer);
  }, [characters, selected?.id]);
  const isPinFeet = selectedPins.includes('foot_l') && selectedPins.includes('foot_r');
  const togglePin = (characterId: string, pin: Pin) =>
    setPins((current) => {
      const list = current[characterId] ?? [];
      return { ...current, [characterId]: list.includes(pin) ? list.filter((entry) => entry !== pin) : [...list, pin] };
    });
  const togglePinFeet = () => {
    if (!selected) return;
    const others = selectedPins.filter((pin) => !pin.startsWith('foot'));
    setPins((current) => ({ ...current, [selected.id]: isPinFeet ? others : [...others, 'foot_l', 'foot_r'] }));
  };

  // The selected character seen from its own front, its left side, its back, or between front and side.
  const lookFrom = (view: ViewName) => {
    if (!selected) return;
    const heading = ((selected.pose.joints?.pelvis?.turn ?? 0) * Math.PI) / 180;
    const facing = new Vector3(Math.sin(heading), 0, Math.cos(heading));
    const itsLeft = new Vector3(Math.cos(heading), 0, -Math.sin(heading));
    const threeQuarter = (THREE_QUARTER_DEGREES * Math.PI) / 180;
    const direction = {
      front: facing,
      side: itsLeft,
      back: facing.clone().negate(),
      'three-quarter': facing.clone().multiplyScalar(Math.cos(threeQuarter)).addScaledVector(itsLeft, Math.sin(threeQuarter)).setY(0.25).normalize(),
    }[view];
    frame(bonePoints(selected), direction);
  };
  const frameAll = () => frame(characters.flatMap((character) => bonePoints(character)));

  // The shortcut list people see is in Help.tsx; keep the two in step.
  const handleKey = (event: KeyboardEvent) => {
    const target = event.target;
    const isTyping =
      (target instanceof HTMLInputElement && !['range', 'color', 'checkbox', 'file'].includes(target.type)) || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
    const key = event.key.toLowerCase();

    if (event.metaKey || event.ctrlKey) {
      if (isTyping || (key !== 'z' && key !== 'y')) return;
      event.preventDefault();
      travel(key === 'y' || event.shiftKey ? 'redo' : 'undo');
      return;
    }
    if (isTyping || event.altKey) return;

    if (key === 'escape') {
      if (partMenu) setPartMenu(null);
      else if (isHelpOpen) setIsHelpOpen(false);
      else if (isCleanView) setIsCleanView(false);
      else setSelectedControl(null);
      return;
    }
    if (key === '?') return setIsHelpOpen(!isHelpOpen);
    if (key === 'h') return setIsCleanView(!isCleanView);
    if (key === 'p') {
      const pin = selectedControl ? pinOfBone(Object.values(CONTROLS[selectedControl].motions)[0].bones[0][0]) : null;
      if (selected && pin) return togglePin(selected.id, pin);
      return togglePinFeet();
    }
    if (key === 'n') {
      if (characters.length === 0) return;
      const next = characters[(characters.findIndex((character) => character.id === selectedId) + 1) % characters.length];
      setSelectedId(next.id);
      setSelectedControl(null);
      return;
    }
    if (key === 'f') {
      if (selected && selectedControl && !event.shiftKey) return lookCloser(selected, selectedControl);
      if (!selected || event.shiftKey) return frameAll();
      return frame(bonePoints(selected));
    }
    if (!selected) return;

    const joints = selected.pose.joints ?? {};
    const view = ({ '1': 'front', '2': 'side', '3': 'back', '4': 'three-quarter' } as Record<string, ViewName>)[key];
    if (view) return lookFrom(view);
    if (key === 'g') return updateCharacter(selected.id, { pose: dropToFloor(buildRig(selected.profile), selected.pose, sceneProps.flatMap(propBoxes)) });
    if (key === 'x') return updateCharacter(selected.id, { pose: mirrorPose(selected.pose, 'flip') });
    if (key === 'r' && event.shiftKey) return updateCharacter(selected.id, { pose: { ...selected.pose, joints: joints.pelvis?.turn ? { pelvis: { turn: joints.pelvis.turn } } : {} } });
    if (!selectedControl) return;

    if (key === 'r') {
      const { [selectedControl]: _removed, ...rest } = joints;
      return updateCharacter(selected.id, { pose: { ...selected.pose, joints: rest } });
    }
    if (key === 'm') updateCharacter(selected.id, { pose: copyLimbToOtherSide(selected.pose, selectedControl) });
  };
  const latestHandleKey = useRef(handleKey);
  latestHandleKey.current = handleKey;
  useEffect(() => {
    const listener = (event: KeyboardEvent) => latestHandleKey.current(event);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  const highlightedBones = selectedControl
    ? Object.values(CONTROLS[selectedControl].motions).flatMap((motion) => motion.bones.map(([bone]) => bone))
    : [];

  const updateCharacter = (id: string, change: Partial<SceneCharacter>, key = `${id}:${Object.keys(change).join()}`) =>
    changeCharacters((list) => list.map((character) => (character.id === id ? { ...character, ...change } : character)), key);

  return (
    <div className={isCleanView ? 'app is-clean' : 'app'}>
      <div className="stage" ref={stageElement}>
        {/* Draws only when something changes, so phones stay cool. */}
        <Canvas
          shadows={SHADOW_TYPE}
          frameloop="demand"
          dpr={[1, 2]}
          onPointerMissed={() => {
            setSelectedControl(null);
            const now = performance.now();
            if (now - lastMissedClick.current < DOUBLE_CLICK_MILLISECONDS) frameAll();
            lastMissedClick.current = now;
          }}
        >
          <Stage
            characters={characters}
            sceneProps={sceneProps}
            lights={lights}
            background={background}
            selected={selected}
            selectedLightId={selectedLightId}
            selectedPropId={selectedPropId}
            onSelectProp={(id) => {
              setSelectedPropId(id);
              setMode('scene');
            }}
            onMoveProp={(id, position, gestureKey) => changeScene((state) => ({ ...state, sceneProps: state.sceneProps.map((prop) => (prop.id === id ? { ...prop, position } : prop)) }), gestureKey)}
            highlightedBones={isCleanView ? [] : highlightedBones}
            isCleanView={isCleanView}
            isCardFolded={isCardFolded}
            onLookCloser={(character, bone) => {
              const controlName = CONTROL_FOR_BONE[bone];
              if (controlName) lookCloser(character, controlName);
            }}
            isFrontView={isFrontView}
            isShowingHandles={mode === 'pose' && !isCleanView}
            touchTarget={touchTarget}
            isPencilOnly={isPencilOnly}
            onTouchTarget={setTouchTarget}
            onTouchDrop={touchOnDrop}
            selectedControl={selectedControl}
            pins={pins}
            onMenu={(characterId, bone, clientX, clientY, isFingerDown) => {
              setSelectedId(characterId);
              setSelectedControl(CONTROL_FOR_BONE[bone] ?? null);
              setPartMenu({ characterId, bone, clientX, clientY });
              isMenuWaitingForRelease.current = isFingerDown;
              if (!isFingerDown) return;
              const release = () => setTimeout(() => (isMenuWaitingForRelease.current = false), MENU_SETTLE_MILLISECONDS);
              window.addEventListener('pointerup', release, { once: true });
            }}
            onTwist={(id, control, motion, degrees, startPose, gestureKey) =>
              updateCharacter(id, { pose: { ...startPose, joints: { ...startPose.joints, [control]: { ...startPose.joints?.[control], [motion]: degrees } } } }, gestureKey)
            }
            exportRequest={exportRequest}
            sceneVersion={sceneVersion}
            lensMm={lensMm}
            cameraJump={cameraJump}
            onCameraJumped={() => setCameraJump(null)}
            onCameraChange={(view) => (cameraView.current = view)}
            onExported={() => setExportRequest(null)}
            onSelect={(id, control) => {
              setSelectedId(id);
              setSelectedControl(control);
              if (mode === 'scene') setMode('pose');
            }}
            onPose={(id, pose, gestureKey) => updateCharacter(id, { pose }, gestureKey)}
          />
        </Canvas>
        {(touchMessage || (overlapCount > 0 && mode === 'pose' && selected)) && !isCleanView && (
          <div className="stage-notice" role="status">
            {touchMessage || `${selected?.profile.name}: ${overlapCount === 1 ? 'a body part sinks' : `${overlapCount} body parts sink`} into another`}
            {!touchMessage && selected && (
              <button
                onClick={() => {
                  const posed = characters.map((entry) => ({ name: entry.profile.name, rig: buildRig(entry.profile), pose: entry.pose }));
                  updateCharacter(selected.id, { pose: separate(posed, characters.indexOf(selected)) }, 'separate');
                }}
              >
                Fix
              </button>
            )}
          </div>
        )}
        {!isCleanView && <Guide />}
        {isCleanView && (
          <button className="show-controls" onClick={() => setIsCleanView(false)}>
            Show controls
          </button>
        )}
      </div>
      {partMenu && (() => {
        const character = characters.find((entry) => entry.id === partMenu.characterId);
        const controlName = CONTROL_FOR_BONE[partMenu.bone];
        if (!character || !controlName) return null;
        const pin = pinOfBone(partMenu.bone);
        const isPinned = !!pin && (pins[character.id] ?? []).includes(pin);
        const joints = character.pose.joints ?? {};
        const isSided = /_[lr]$/.test(controlName);
        const isLeg = /^(hip|knee|ankle|toes)_/.test(controlName);
        const act = (action: () => void) => () => {
          action();
          setPartMenu(null);
        };
        return (
          <>
            <div
              className="menu-backdrop"
              onClick={() => {
                if (!isMenuWaitingForRelease.current) setPartMenu(null);
              }}
              onContextMenu={(event) => event.preventDefault()}
            />
            <div className="menu-list part-menu" style={{ left: Math.min(partMenu.clientX, window.innerWidth - 230), top: Math.min(partMenu.clientY, window.innerHeight - 220) }} role="menu">
              <strong>{partName(controlName)}</strong>
              <button onClick={act(() => lookCloser(character, controlName))}>Look closer</button>
              <button
                onClick={act(() => {
                  const { [controlName]: _removed, ...rest } = joints;
                  updateCharacter(character.id, { pose: { ...character.pose, joints: rest } });
                })}
              >
                Reset this part
              </button>
              {isSided && <button onClick={act(() => updateCharacter(character.id, { pose: copyLimbToOtherSide(character.pose, controlName) }))}>Copy this {isLeg ? 'leg' : 'arm'} to the other side</button>}
              {pin && <button onClick={act(() => togglePin(character.id, pin))}>{isPinned ? 'Unpin' : 'Pin'} this {pin.startsWith('hand') ? 'hand' : 'foot'}</button>}
            </div>
          </>
        );
      })()}
      {isHelpOpen && (
        <Help
          isPencilOnly={isPencilOnly}
          onChangePencilOnly={(isOn) => {
            setIsPencilOnly(isOn);
            try {
              localStorage.setItem(PENCIL_ONLY_STORAGE_KEY, isOn ? 'yes' : 'no');
            } catch {
              // Only a convenience; the setting still works for this visit.
            }
          }}
          onClose={() => setIsHelpOpen(false)}
          onHideControls={() => {
            setIsHelpOpen(false);
            setIsCleanView(true);
          }}
        />
      )}
      <Panel
        characters={characters}
        sceneProps={sceneProps}
        lights={lights}
        background={background}
        selected={selected}
        selectedControl={selectedControl}
        selectedLightId={selectedLightId}
        selectedPropId={selectedPropId}
        onSelectLight={setSelectedLightId}
        onSelectProp={setSelectedPropId}
        onChangeProps={(update, key) => changeScene((state) => ({ ...state, sceneProps: update(state.sceneProps) }), key)}
        mode={mode}
        onChangeMode={setMode}
        onLookFrom={lookFrom}
        onFrameAll={frameAll}
        isFrontView={isFrontView}
        onToggleFrontView={() => setIsFrontView(!isFrontView)}
        isPinFeet={isPinFeet}
        onTogglePinFeet={togglePinFeet}
        pins={selectedPins}
        onTogglePin={(pin) => selected && togglePin(selected.id, pin)}
        canUndo={scene.past.length > 0}
        canRedo={scene.future.length > 0}
        onTravel={travel}
        onOpenHelp={() => setIsHelpOpen(true)}
        isCardFolded={isCardFolded}
        onFoldCard={setIsCardFolded}
        views={views}
        lensMm={lensMm}
        onChangeLens={(next) => {
          setIsFrontView(false);
          setLensMm(next);
        }}
        getCameraView={() => cameraView.current}
        onGoToView={goToView}
        onChangeViews={(update, key) => changeScene((state) => ({ ...state, views: update(state.views) }), key)}
        onChangeLights={(update, key) => changeScene((state) => ({ ...state, lights: update(state.lights) }), key)}
        onChangeBackground={(color) => changeScene((state) => ({ ...state, background: color }), 'background')}
        onExport={setExportRequest}
        onSelectCharacter={(id) => {
          setSelectedId(id);
          setSelectedControl(null);
        }}
        onSelectControl={setSelectedControl}
        onUpdateCharacter={updateCharacter}
        onReplaceScene={(next, camera) => {
          changeScene(() => next, 'replace');
          setSceneVersion((version) => version + 1);
          if (camera) goToView(camera);
          setSelectedId(next.characters[0]?.id ?? null);
          setSelectedControl(null);
          setSelectedLightId(null);
          setSelectedPropId(null);
        }}
        onAddCharacter={(profile) => {
          const rightmost = Math.max(-CHARACTER_SPACING, ...characters.map((character) => character.pose.position?.[0] ?? 0));
          const added: SceneCharacter = { id: newCharacterId(), profile: normalizeProfile(profile), pose: { position: [rightmost + CHARACTER_SPACING, 0, 0] } };
          changeCharacters((list) => [...list, added], 'add');
          setSelectedId(added.id);
          setSelectedControl(null);
        }}
        onRemoveCharacter={(id) => {
          changeCharacters((list) => list.filter((character) => character.id !== id), 'remove');
          setSelectedId(characters.find((character) => character.id !== id)?.id ?? null);
          setSelectedControl(null);
        }}
      />
    </div>
  );
}

interface StageProps {
  characters: SceneCharacter[];
  sceneProps: PropEntry[];
  lights: LightEntry[];
  background: string;
  selected: SceneCharacter | null;
  selectedLightId: string | null;
  selectedPropId: string | null;
  onSelectProp: (id: string) => void;
  onMoveProp: (id: string, position: Vec3, gestureKey: string) => void;
  highlightedBones: string[];
  isCleanView: boolean;
  isCardFolded: boolean;
  onLookCloser: (character: SceneCharacter, bone: string) => void;
  isFrontView: boolean;
  isShowingHandles: boolean;
  touchTarget: TouchTarget | null;
  isPencilOnly: boolean;
  onTouchTarget: (target: TouchTarget | null) => void;
  onTouchDrop: (character: SceneCharacter, part: string, target: TouchTarget) => void;
  selectedControl: string | null;
  pins: Record<string, Pin[]>;
  onMenu: (characterId: string, bone: string, clientX: number, clientY: number, isFingerDown: boolean) => void;
  onTwist: (id: string, control: string, motion: string, degrees: number, startPose: Pose, gestureKey: string) => void;
  exportRequest: ExportRequest | null;
  sceneVersion: number;
  lensMm: number;
  cameraJump: CameraView | null;
  onCameraJumped: () => void;
  onCameraChange: (view: CameraView) => void;
  onExported: () => void;
  onSelect: (id: string, control: string | null) => void;
  onPose: (id: string, pose: Pose, gestureKey: string) => void;
}

function Stage(props: StageProps) {
  const { characters, lights, background, selected, highlightedBones, isFrontView, exportRequest, onSelect, onPose } = props;
  const viewportHeight = useThree((state) => state.size.height);
  const viewportWidth = useThree((state) => state.size.width);
  // Start far enough back that everyone fits, even on a narrow phone held upright. Later the camera is the user's.
  // Recomputed only when a whole scene is opened (file or share link), so normal editing never moves the camera.
  const isWide = viewportWidth > WIDE_STAGE_PIXELS && !props.isCleanView;
  const coveredLeft = isWide ? RAIL_SPACE_PIXELS : 0;
  const coveredRight = isWide && !props.isCardFolded ? CARD_SPACE_PIXELS : 0;
  const startDistance = useMemo(() => {
    const halfSpread = Math.max(0, ...characters.map((character) => Math.abs(character.pose.position?.[0] ?? 0))) + 0.6;
    const freeWidth = viewportWidth - coveredLeft - coveredRight;
    const horizontalHalfTangent = Math.tan((fieldOfViewDegrees(props.lensMm) * Math.PI) / 360) * (freeWidth / Math.max(1, viewportHeight));
    return Math.max(5.5, halfSpread / horizontalHalfTangent + 0.5);
  }, [props.sceneVersion]);
  const renderer = useThree((state) => state.gl);
  const threeScene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const invalidate = useThree((state) => state.invalidate);
  const startDrag = useDragPosing({
    onPose,
    onLongPress: (character, bone, clientX, clientY) => props.onMenu(character.id, bone, clientX, clientY, true),
    onTouchTarget: props.onTouchTarget,
    onTouchDrop: props.onTouchDrop,
  });
  const isExporting = exportRequest !== null;
  const isShowingGuides = !isExporting || exportRequest.isShowingGuides;

  // Opening a scene swaps in a new camera and controls during this render; reading the store when an effect runs gets the new ones.
  const getThree = useThree((state) => state.get);
  const liveCamera = () => {
    const { camera: current, controls } = getThree();
    const orbit = controls as unknown as { target: Vector3; update: () => void; enableDamping: boolean } | null;
    return current instanceof ThreePerspectiveCamera && orbit ? { camera: current, controls: orbit } : null;
  };
  const lastLensMm = useRef(props.lensMm);

  // Mannequin and light targets move their three.js objects directly, which "demand" drawing doesn't notice.
  useEffect(() => invalidate());

  // The picture slides sideways so the middle of the view is the middle of the stage the rail and card leave free.
  useEffect(() => {
    const shift = (coveredRight - coveredLeft) / 2;
    if (shift === 0) camera.clearViewOffset();
    else camera.setViewOffset(viewportWidth, viewportHeight, shift, 0, viewportWidth, viewportHeight);
    camera.updateProjectionMatrix();
    invalidate();
  }, [camera, viewportWidth, viewportHeight, coveredLeft, coveredRight]);

  const reportCamera = () => {
    const live = liveCamera();
    if (isFrontView || !live) return;
    const round = (vector: Vector3) => vector.toArray().map((value) => Math.round(value * 1000) / 1000) as Vec3;
    props.onCameraChange({ position: round(live.camera.position), target: round(live.controls.target), lensMm: props.lensMm });
  };

  // A new lens moves the camera closer or further along its line of sight, so the characters keep their size and only the perspective changes.
  useEffect(() => {
    const previous = lastLensMm.current;
    lastLensMm.current = props.lensMm;
    const live = liveCamera();
    if (previous === props.lensMm || props.cameraJump || !live) return;
    const offset = live.camera.position.clone().sub(live.controls.target);
    const distance = distanceForLens(offset.length(), previous, props.lensMm);
    live.camera.position.copy(live.controls.target).addScaledVector(offset.normalize(), distance);
    live.controls.update();
    reportCamera();
  }, [props.lensMm]);

  useEffect(() => {
    const live = liveCamera();
    if (!props.cameraJump || !live) return;
    // A spin the user just flicked keeps going (damping) and would carry the camera off the saved view; one undamped update stops it.
    live.controls.enableDamping = false;
    live.controls.update();
    live.camera.position.set(...props.cameraJump.position);
    live.controls.target.set(...props.cameraJump.target);
    live.controls.update();
    live.controls.enableDamping = true;
    props.onCameraJumped();
    reportCamera();
  }, [props.cameraJump, camera]);
  useEffect(reportCamera, [camera, isFrontView]);

  // Runs after React has hidden the helpers, renders one sharper frame by hand and saves it.
  useEffect(() => {
    if (!exportRequest) return;
    const size = renderer.getSize(new Vector2());
    const screenPixelRatio = renderer.getPixelRatio();
    const pixelRatio = Math.min(exportRequest.scale, MAX_EXPORT_PIXELS / Math.max(size.x, size.y));
    const savedBackground = threeScene.background;
    if (exportRequest.isTransparent) threeScene.background = null;
    renderer.setPixelRatio(pixelRatio);
    renderer.render(threeScene, camera);
    const url = renderer.domElement.toDataURL('image/png');
    threeScene.background = savedBackground;
    renderer.setPixelRatio(screenPixelRatio);
    console.log(`Saved PNG ${Math.round(size.x * pixelRatio)}×${Math.round(size.y * pixelRatio)}`);

    const link = document.createElement('a');
    link.href = url;
    link.download = 'poser.png';
    link.click();
    props.onExported();
  }, [exportRequest]);
  const leftmost = Math.min(0, ...characters.map((character) => character.pose.position?.[0] ?? 0));
  const focusX = selected?.pose.position?.[0] ?? 0;
  const focusHeight = selected ? selected.profile.heightCm / 100 : 1.7;

  const rulerTicks: number[] = [];
  for (let centimeters = 0; centimeters <= RULER_HEIGHT_METERS * 100; centimeters += 10) rulerTicks.push(centimeters);

  return (
    <>
      <color attach="background" args={[background]} />
      {isFrontView ? (
        <OrthographicCamera makeDefault position={[focusX, focusHeight / 2, 10]} zoom={viewportHeight / (focusHeight * 1.25)} />
      ) : (
        <PerspectiveCamera key={props.sceneVersion} makeDefault position={[0.6, 1.5, startDistance]} fov={fieldOfViewDegrees(props.lensMm)} />
      )}
      <OrbitControls key={isFrontView ? `front-${focusX}` : `free-${props.sceneVersion}`} target={[isFrontView ? focusX : 0, isFrontView ? focusHeight / 2 : 1, 0]} enableRotate={!isFrontView} mouseButtons={{ LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.ROTATE, RIGHT: MOUSE.PAN }} zoomToCursor makeDefault onChange={reportCamera} />

      <SceneLights lights={lights} selectedLightId={props.selectedLightId} isShowingMarkers={!isExporting} />

      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[40, 40]} />
        <shadowMaterial opacity={0.18} />
      </mesh>
      <PropMeshes props={props.sceneProps} selectedPropId={props.selectedPropId} isExporting={isExporting} onSelect={props.onSelectProp} onMove={props.onMoveProp} />
      <Grid visible={isShowingGuides} infiniteGrid cellSize={0.1} sectionSize={1} cellColor="#c9ccd6" sectionColor="#9aa0b3" fadeDistance={25} position={[0, 0.001, 0]} />

      <group visible={isShowingGuides} position={[leftmost - 0.7, 0, -0.3]}>
        <mesh position={[0, RULER_HEIGHT_METERS / 2, 0]}>
          <boxGeometry args={[0.008, RULER_HEIGHT_METERS, 0.008]} />
          <meshBasicMaterial color="#6b7085" />
        </mesh>
        {rulerTicks.map((centimeters) => (
          <mesh key={centimeters} position={[0.03, centimeters / 100, 0]}>
            <boxGeometry args={[centimeters % 50 === 0 ? 0.08 : 0.04, 0.004, 0.004]} />
            <meshBasicMaterial color="#6b7085" />
            {centimeters % 50 === 0 && (
              <Html position={[0.08, 0, 0]} center={false} className="ruler-label" zIndexRange={[1, 0]}>
                {centimeters} cm
              </Html>
            )}
          </mesh>
        ))}
      </group>

      {characters.map((character) => (
        <group key={character.id}>
          <Mannequin
            characterId={character.id}
            targetBone={props.touchTarget?.characterId === character.id ? props.touchTarget.bone : null}
            pinnedBones={(props.pins[character.id] ?? []).flatMap((pin) =>
              pin.startsWith('hand') ? [`wrist_${pin.slice(-1)}`, ...['thumb', 'index', 'middle', 'ring', 'pinky'].flatMap((finger) => [1, 2, 3].map((joint) => `${finger}_${joint}_${pin.slice(-1)}`))] : [`ankle_${pin.slice(-1)}`, `toes_${pin.slice(-1)}`],
            )}
            isPencilOnly={props.isPencilOnly}
            profile={character.profile}
            pose={character.pose}
            highlightedBones={character.id === selected?.id && !isExporting ? highlightedBones : []}
            onGrab={(grab) => {
              onSelect(character.id, CONTROL_FOR_BONE[grab.bone] ?? null);
              startDrag(character, grab, props.pins[character.id] ?? []);
            }}
            onLookCloser={(bone) => {
              onSelect(character.id, CONTROL_FOR_BONE[bone] ?? null);
              props.onLookCloser(character, bone);
            }}
            onMenu={(bone, clientX, clientY) => props.onMenu(character.id, bone, clientX, clientY, false)}
          />
          {character.id === selected?.id && props.isShowingHandles && !isExporting && (
            <Handles
              character={character}
              selectedControl={props.selectedControl}
              isPencilOnly={props.isPencilOnly}
              onTwist={(control, motion, degrees, startPose, gestureKey) => props.onTwist(character.id, control, motion, degrees, startPose, gestureKey)}
            />
          )}
          {character.reference && <ReferenceImage character={character} isVisible={!isExporting} />}
          {character.id === selected?.id && !props.isCleanView && (
            <Html position={[character.pose.position?.[0] ?? 0, character.profile.heightCm / 100 + 0.12, character.pose.position?.[2] ?? 0]} center className="name-label" zIndexRange={[1, 0]}>
              {character.profile.name} · {character.profile.heightCm} cm
            </Html>
          )}
        </group>
      ))}
    </>
  );
}

// crypto.randomUUID only exists on https/localhost; a phone opening the dev server over Wi-Fi uses plain http.
let idCounter = 0;
export function newCharacterId() {
  idCounter += 1;
  return `character-${idCounter}`;
}

export function newLightId() {
  idCounter += 1;
  return `light-${idCounter}`;
}

export function newPropId() {
  idCounter += 1;
  return `prop-${idCounter}`;
}

function ReferenceImage({ character, isVisible }: { character: SceneCharacter; isVisible: boolean }) {
  const [texture, setTexture] = useState<Texture | null>(null);
  const url = character.reference!.url;

  useEffect(() => {
    const loaded = new TextureLoader().load(url, (result) => setTexture(result));
    loaded.colorSpace = SRGBColorSpace;
    return () => loaded.dispose();
  }, [url]);

  if (!texture) return null;
  const height = character.profile.heightCm / 100;
  const image = texture.image as HTMLImageElement;
  const width = (height * image.width) / image.height;
  const [x, , z] = character.pose.position ?? [0, 0, 0];

  return (
    <mesh visible={isVisible} position={[x, height / 2, z - 0.4]} renderOrder={-1}>
      <planeGeometry args={[width, height]} />
      <meshBasicMaterial map={texture} transparent opacity={character.reference!.opacity} depthWrite={false} />
    </mesh>
  );
}
// #endregion
