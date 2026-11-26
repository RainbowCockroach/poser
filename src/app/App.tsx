/*
 * Poser app shell: the 3D stage on the left (or top on phones) and the edit panel.
 * Scene state lives here: the characters, each with a profile (body) and a pose.
 * Scenes and characters are saved as JSON files ("poser.scene/1", "poser.character/1") to share.
 * Run: npm run dev
 */

// #region Setup
import { useEffect, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { Grid, Html, OrbitControls, OrthographicCamera, PerspectiveCamera } from '@react-three/drei';
import { SRGBColorSpace, TextureLoader, type Texture } from 'three';
import { Mannequin } from './Mannequin';
import { Panel } from './Panel';
import { normalizeProfile, type CharacterProfile } from '../core/rig';
import { CONTROL_FOR_BONE, CONTROLS, type Pose } from '../core/pose';
// #endregion

// #region Types and config
export interface SceneCharacter {
  id: string;
  profile: CharacterProfile;
  pose: Pose;
  reference?: { url: string; opacity: number };
}

export interface SceneFile {
  format: 'poser.scene/1';
  characters: { profile: CharacterProfile; pose: Pose }[];
}

const SAMPLE_PROFILES = Object.values(
  import.meta.glob('../../characters/*.oc.json', { eager: true, import: 'default' }),
) as CharacterProfile[];

const CHARACTER_SPACING = 0.9;
const RULER_HEIGHT_METERS = 2.5;
// #endregion

// #region Main flow
export function App() {
  const [characters, setCharacters] = useState<SceneCharacter[]>(() =>
    [...SAMPLE_PROFILES]
      .sort((a, b) => b.heightCm - a.heightCm)
      .map((profile, index, all) => ({
        id: newCharacterId(),
        profile: normalizeProfile(profile),
        pose: { position: [(index - (all.length - 1) / 2) * CHARACTER_SPACING, 0, 0] },
      })),
  );
  const [selectedId, setSelectedId] = useState<string | null>(() => characters[0]?.id ?? null);
  const [selectedControl, setSelectedControl] = useState<string | null>(null);
  const [isFrontView, setIsFrontView] = useState(false);

  const selected = characters.find((character) => character.id === selectedId) ?? null;
  const highlightedBones = selectedControl
    ? Object.values(CONTROLS[selectedControl].motions).flatMap((motion) => motion.bones.map(([bone]) => bone))
    : [];

  const updateCharacter = (id: string, change: Partial<SceneCharacter>) =>
    setCharacters((list) => list.map((character) => (character.id === id ? { ...character, ...change } : character)));

  return (
    <div className="app">
      <div className="stage">
        <Canvas shadows dpr={[1, 2]} onPointerMissed={() => setSelectedControl(null)}>
          <Stage
            characters={characters}
            selected={selected}
            highlightedBones={highlightedBones}
            isFrontView={isFrontView}
            onSelect={(id, control) => {
              setSelectedId(id);
              setSelectedControl(control);
            }}
          />
        </Canvas>
        <button className="view-toggle" onClick={() => setIsFrontView(!isFrontView)}>
          {isFrontView ? '3D view' : 'Front view'}
        </button>
      </div>
      <Panel
        characters={characters}
        selected={selected}
        selectedControl={selectedControl}
        onSelectCharacter={(id) => {
          setSelectedId(id);
          setSelectedControl(null);
        }}
        onSelectControl={setSelectedControl}
        onUpdateCharacter={updateCharacter}
        onReplaceScene={(next) => {
          setCharacters(next);
          setSelectedId(next[0]?.id ?? null);
          setSelectedControl(null);
        }}
        onAddCharacter={(profile) => {
          const rightmost = Math.max(-CHARACTER_SPACING, ...characters.map((character) => character.pose.position?.[0] ?? 0));
          const added: SceneCharacter = { id: newCharacterId(), profile: normalizeProfile(profile), pose: { position: [rightmost + CHARACTER_SPACING, 0, 0] } };
          setCharacters([...characters, added]);
          setSelectedId(added.id);
          setSelectedControl(null);
        }}
        onRemoveCharacter={(id) => {
          setCharacters(characters.filter((character) => character.id !== id));
          setSelectedId(null);
          setSelectedControl(null);
        }}
      />
    </div>
  );
}

interface StageProps {
  characters: SceneCharacter[];
  selected: SceneCharacter | null;
  highlightedBones: string[];
  isFrontView: boolean;
  onSelect: (id: string, control: string | null) => void;
}

function Stage({ characters, selected, highlightedBones, isFrontView, onSelect }: StageProps) {
  const viewportHeight = useThree((state) => state.size.height);
  const leftmost = Math.min(0, ...characters.map((character) => character.pose.position?.[0] ?? 0));
  const focusX = selected?.pose.position?.[0] ?? 0;
  const focusHeight = selected ? selected.profile.heightCm / 100 : 1.7;

  const rulerTicks: number[] = [];
  for (let centimeters = 0; centimeters <= RULER_HEIGHT_METERS * 100; centimeters += 10) rulerTicks.push(centimeters);

  return (
    <>
      <color attach="background" args={['#eef0f5']} />
      {isFrontView ? (
        <OrthographicCamera makeDefault position={[focusX, focusHeight / 2, 10]} zoom={viewportHeight / (focusHeight * 1.25)} />
      ) : (
        <PerspectiveCamera makeDefault position={[0.6, 1.5, 5.5]} fov={40} />
      )}
      <OrbitControls key={isFrontView ? `front-${focusX}` : 'free'} target={[isFrontView ? focusX : 0, isFrontView ? focusHeight / 2 : 1, 0]} enableRotate={!isFrontView} makeDefault />

      <hemisphereLight args={['#ffffff', '#b9a99a', 1.2]} />
      <directionalLight position={[3, 6, 4]} intensity={2} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-5} shadow-camera-right={5} shadow-camera-top={5} shadow-camera-bottom={-5} />

      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[40, 40]} />
        <shadowMaterial opacity={0.18} />
      </mesh>
      <Grid infiniteGrid cellSize={0.1} sectionSize={1} cellColor="#c9ccd6" sectionColor="#9aa0b3" fadeDistance={25} position={[0, 0.001, 0]} />

      <group position={[leftmost - 0.7, 0, -0.3]}>
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
            highlightedBones={character.id === selected?.id ? highlightedBones : []}
            onSelectBone={(bone) => onSelect(character.id, CONTROL_FOR_BONE[bone] ?? null)}
          />
          {character.reference && <ReferenceImage character={character} />}
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
let characterCounter = 0;
export function newCharacterId() {
  characterCounter += 1;
  return `character-${characterCounter}`;
}

function ReferenceImage({ character }: { character: SceneCharacter }) {
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
    <mesh position={[x, height / 2, z - 0.4]} renderOrder={-1}>
      <planeGeometry args={[width, height]} />
      <meshBasicMaterial map={texture} transparent opacity={character.reference!.opacity} depthWrite={false} />
    </mesh>
  );
}
// #endregion
