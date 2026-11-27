/*
 * Poser app shell: the 3D stage on the left (or top on phones) and the edit panel.
 * Scene state lives here: the characters (each a profile and a pose), the lights, the background, plus undo history.
 * Scenes and characters are saved as JSON files ("poser.scene/1", "poser.character/1") to share.
 * "Save PNG" re-renders the current view without the editing helpers (grid, ruler, light markers).
 * Run: npm run dev
 */

// #region Setup
import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { Grid, Html, OrbitControls, OrthographicCamera, PerspectiveCamera } from '@react-three/drei';
import { SRGBColorSpace, TextureLoader, Vector2, type Texture } from 'three';
import { Mannequin } from './Mannequin';
import { Panel } from './Panel';
import { SceneLights } from './SceneLights';
import { normalizeProfile, type CharacterProfile } from '../core/rig';
import { CONTROL_FOR_BONE, CONTROLS, type Pose } from '../core/pose';
import { DEFAULT_LIGHTS, type SceneLight } from '../core/lights';
import { useDragPosing } from './useDragPosing';
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
  lights: LightEntry[];
  background: string;
}

export interface SceneFile {
  format: 'poser.scene/1';
  characters: { profile: CharacterProfile; pose: Pose }[];
  lights?: SceneLight[];
  background?: string;
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
const CAMERA_FIELD_OF_VIEW = 40;
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
      lights: DEFAULT_LIGHTS.map((light) => ({ ...light, id: newLightId() })),
      background: DEFAULT_BACKGROUND,
    } as SceneState,
    past: [] as SceneState[],
    future: [] as SceneState[],
  }));
  const { characters, lights, background } = scene.present;
  const lastChange = useRef({ key: '', time: 0 });
  const [selectedId, setSelectedId] = useState<string | null>(() => characters[0]?.id ?? null);
  const [selectedControl, setSelectedControl] = useState<string | null>(null);
  const [selectedLightId, setSelectedLightId] = useState<string | null>(null);
  const [isFrontView, setIsFrontView] = useState(false);
  const [isPinFeet, setIsPinFeet] = useState(false);
  const [exportRequest, setExportRequest] = useState<ExportRequest | null>(null);
  const [sceneVersion, setSceneVersion] = useState(0);

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
            lights={lights}
            background={background}
            selected={selected}
            selectedLightId={selectedLightId}
            highlightedBones={highlightedBones}
            isFrontView={isFrontView}
            isPinFeet={isPinFeet}
            exportRequest={exportRequest}
            sceneVersion={sceneVersion}
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
        lights={lights}
        background={background}
        selected={selected}
        selectedControl={selectedControl}
        selectedLightId={selectedLightId}
        onSelectLight={setSelectedLightId}
        onChangeLights={(update, key) => changeScene((state) => ({ ...state, lights: update(state.lights) }), key)}
        onChangeBackground={(color) => changeScene((state) => ({ ...state, background: color }), 'background')}
        onExport={setExportRequest}
        onSelectCharacter={(id) => {
          setSelectedId(id);
          setSelectedControl(null);
        }}
        onSelectControl={setSelectedControl}
        onUpdateCharacter={updateCharacter}
        onReplaceScene={(next) => {
          changeScene(() => next, 'replace');
          setSceneVersion((version) => version + 1);
          setSelectedId(next.characters[0]?.id ?? null);
          setSelectedControl(null);
          setSelectedLightId(null);
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
  lights: LightEntry[];
  background: string;
  selected: SceneCharacter | null;
  selectedLightId: string | null;
  highlightedBones: string[];
  isFrontView: boolean;
  isPinFeet: boolean;
  exportRequest: ExportRequest | null;
  sceneVersion: number;
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
    const horizontalHalfTangent = Math.tan((CAMERA_FIELD_OF_VIEW * Math.PI) / 360) * (viewportWidth / Math.max(1, viewportHeight));
    return Math.max(5.5, halfSpread / horizontalHalfTangent + 0.5);
  }, [props.sceneVersion]);
  const renderer = useThree((state) => state.gl);
  const threeScene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const invalidate = useThree((state) => state.invalidate);
  const startDrag = useDragPosing(isPinFeet, onPose);
  const isExporting = exportRequest !== null;
  const isShowingGuides = !isExporting || exportRequest.isShowingGuides;

  // Mannequin and light targets move their three.js objects directly, which "demand" drawing doesn't notice.
  useEffect(() => invalidate());

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
        <PerspectiveCamera key={props.sceneVersion} makeDefault position={[0.6, 1.5, startDistance]} fov={CAMERA_FIELD_OF_VIEW} />
      )}
      <OrbitControls key={isFrontView ? `front-${focusX}` : `free-${props.sceneVersion}`} target={[isFrontView ? focusX : 0, isFrontView ? focusHeight / 2 : 1, 0]} enableRotate={!isFrontView} makeDefault />

      <SceneLights lights={lights} selectedLightId={props.selectedLightId} isShowingMarkers={!isExporting} />

      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[40, 40]} />
        <shadowMaterial opacity={0.18} />
      </mesh>
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
