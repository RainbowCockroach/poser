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
import { PerspectiveCamera as ThreePerspectiveCamera, SRGBColorSpace, TextureLoader, Vector2, Vector3, type Texture } from 'three';
import { Mannequin } from './Mannequin';
import { Panel } from './Panel';
import { SceneLights } from './SceneLights';
import { normalizeProfile, type CharacterProfile } from '../core/rig';
import { CONTROL_FOR_BONE, CONTROLS, type Pose } from '../core/pose';
import { DEFAULT_LIGHTS, type SceneLight } from '../core/lights';
import { useDragPosing } from './useDragPosing';
import { PropMeshes, type PropEntry } from './Props';
import type { SceneProp } from '../core/props';
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
  const [isPinFeet, setIsPinFeet] = useState(false);
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

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.target instanceof HTMLInputElement && event.target.type === 'text') return;
      const key = event.key.toLowerCase();
      if (key !== 'z' && key !== 'y') return;
      event.preventDefault();
      travel(key === 'y' || event.shiftKey ? 'redo' : 'undo');
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  const selected = characters.find((character) => character.id === selectedId) ?? null;
  const highlightedBones = selectedControl
    ? Object.values(CONTROLS[selectedControl].motions).flatMap((motion) => motion.bones.map(([bone]) => bone))
    : [];

  const updateCharacter = (id: string, change: Partial<SceneCharacter>, key = `${id}:${Object.keys(change).join()}`) =>
    changeCharacters((list) => list.map((character) => (character.id === id ? { ...character, ...change } : character)), key);

  return (
    <div className="app">
      <div className="stage">
        {/* Draws only when something changes, so phones stay cool. */}
        <Canvas shadows={SHADOW_TYPE} frameloop="demand" dpr={[1, 2]} onPointerMissed={() => setSelectedControl(null)}>
          <Stage
            characters={characters}
            sceneProps={sceneProps}
            lights={lights}
            background={background}
            selected={selected}
            selectedLightId={selectedLightId}
            selectedPropId={selectedPropId}
            onSelectProp={setSelectedPropId}
            onMoveProp={(id, position, gestureKey) => changeScene((state) => ({ ...state, sceneProps: state.sceneProps.map((prop) => (prop.id === id ? { ...prop, position } : prop)) }), gestureKey)}
            highlightedBones={highlightedBones}
            isFrontView={isFrontView}
            isPinFeet={isPinFeet}
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
            }}
            onPose={(id, pose, gestureKey) => updateCharacter(id, { pose }, gestureKey)}
          />
        </Canvas>
        <div className="stage-tools">
          <button onClick={() => setIsFrontView(!isFrontView)}>{isFrontView ? '3D view' : 'Front view'}</button>
          <button onClick={() => travel('undo')} disabled={scene.past.length === 0} title="Undo (Ctrl/Cmd+Z)">
            Undo
          </button>
          <button onClick={() => travel('redo')} disabled={scene.future.length === 0} title="Redo (Ctrl/Cmd+Shift+Z)">
            Redo
          </button>
          <button className={isPinFeet ? 'is-active' : ''} onClick={() => setIsPinFeet(!isPinFeet)} title="When on, dragging the hips bends the legs and keeps the feet where they are">
            Pin feet {isPinFeet ? 'on' : 'off'}
          </button>
        </div>
      </div>
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
          setSelectedId(null);
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
  isFrontView: boolean;
  isPinFeet: boolean;
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
  const { characters, lights, background, selected, highlightedBones, isFrontView, isPinFeet, exportRequest, onSelect, onPose } = props;
  const viewportHeight = useThree((state) => state.size.height);
  const viewportWidth = useThree((state) => state.size.width);
  // Start far enough back that everyone fits, even on a narrow phone held upright. Later the camera is the user's.
  // Recomputed only when a whole scene is opened (file or share link), so normal editing never moves the camera.
  const startDistance = useMemo(() => {
    const halfSpread = Math.max(0, ...characters.map((character) => Math.abs(character.pose.position?.[0] ?? 0))) + 0.6;
    const horizontalHalfTangent = Math.tan((fieldOfViewDegrees(props.lensMm) * Math.PI) / 360) * (viewportWidth / Math.max(1, viewportHeight));
    return Math.max(5.5, halfSpread / horizontalHalfTangent + 0.5);
  }, [props.sceneVersion]);
  const renderer = useThree((state) => state.gl);
  const threeScene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const invalidate = useThree((state) => state.invalidate);
  const startDrag = useDragPosing(isPinFeet, onPose);
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
      <OrbitControls key={isFrontView ? `front-${focusX}` : `free-${props.sceneVersion}`} target={[isFrontView ? focusX : 0, isFrontView ? focusHeight / 2 : 1, 0]} enableRotate={!isFrontView} makeDefault onChange={reportCamera} />

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
            profile={character.profile}
            pose={character.pose}
            highlightedBones={character.id === selected?.id && !isExporting ? highlightedBones : []}
            onGrab={(grab) => {
              onSelect(character.id, CONTROL_FOR_BONE[grab.bone] ?? null);
              startDrag(character, grab);
            }}
          />
          {character.reference && <ReferenceImage character={character} isVisible={!isExporting} />}
          {character.id === selected?.id && (
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
