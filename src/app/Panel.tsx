/*
 * Everything on top of the stage: the top bar (file menu, characters, undo), the five modes (a rail on the left,
 * a tab bar on phones) and the card for the current mode (on the right, a bottom sheet on phones).
 * Pose mode shows only the selected body part; with none selected it shows whole-pose actions. Exact numbers,
 * the body part list and placing by numbers sit behind "More".
 * Joint sliders only allow the range a real body can do (limits live in core/pose.ts); labels are in labels.ts.
 * "My poses" are kept in this browser (localStorage); download a pose to share it.
 */

// #region Setup
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { CONTROLS, copyLimbToOtherSide, mirrorPose, type Pose, type PoseFile } from '../core/pose';
import { dropToFloor, type Pin } from '../core/reach';
import { MAX_SHARE_LINK_LENGTH, packForLink, readShareHash, shareLink, unpackFromLink, type SharedKind } from '../core/share';
import { applyHandShape, HAND_SHAPES, type HandSide } from '../core/hands';
import { BODY_PARTS, findOverlaps, separate, touch, type PosedCharacter, type TouchSide } from '../core/body';
import { buildRig, DEFAULT_PROFILE, normalizeProfile, type CharacterProfile } from '../core/rig';
import { DEFAULT_LIGHTS, LIGHT_PRESETS, MAX_INTENSITY, newLight, normalizeLight, placementOf, positionFromPlacement, type LightKind, type LightPlacement, type SceneLight } from '../core/lights';
import { newProp, normalizeProp, PROP_KINDS, propBoxes, MAX_PROP_SIZE, MIN_PROP_SIZE, type PropKind } from '../core/props';
import type { PropEntry } from './Props';
import { motionWords, partName } from './labels';
import { THUMBNAIL_PIXELS, Tile, type ThumbnailRequest } from './Thumbnail';
import { Guide } from './Guide';
import { LENS_PRESETS, MAX_LENS_MM, MIN_LENS_MM, normalizeView, type CameraView } from '../core/camera';
import { partForControl, DEFAULT_BACKGROUND, newCharacterId, newLightId, newPropId, type ExportRequest, type LightEntry, type SceneCharacter, type SceneFile, type SceneState } from './App';
// #endregion

// #region Config
export type Mode = 'pose' | 'library' | 'body' | 'scene' | 'camera';
export type ViewName = 'front' | 'side' | 'back' | 'three-quarter';

const MODES: { mode: Mode; label: string }[] = [
  { mode: 'pose', label: 'Pose' },
  { mode: 'library', label: 'Library' },
  { mode: 'body', label: 'Body' },
  { mode: 'scene', label: 'Scene' },
  { mode: 'camera', label: 'Camera' },
];

const VIEW_BUTTONS: { view: ViewName; label: string; key: string }[] = [
  { view: 'front', label: 'Front', key: '1' },
  { view: 'side', label: 'Side', key: '2' },
  { view: 'back', label: 'Back', key: '3' },
  { view: 'three-quarter', label: 'Three-quarter', key: '4' },
];

const PRESET_POSES = (Object.values(import.meta.glob('../../poses/*.pose.json', { eager: true, import: 'default' })) as PoseFile[]).sort((a, b) =>
  a.name.localeCompare(b.name),
);
const MY_POSES_STORAGE_KEY = 'poser.myPoses';
const THUMBNAIL_BACKGROUND = '#eef0f5';
// The right arm raised toward the camera, so a hand shape reads in a small picture.
const HAND_PICTURE_JOINTS: Pose['joints'] = { shoulder_r: { flexion: 80 }, elbow_r: { flexion: 70 } };
const SHOW_MORE_STORAGE_KEY = 'poser.showMore';
const MESSAGE_MILLISECONDS = 5000;
const PROPORTION_SLIDERS: { key: keyof CharacterProfile['proportions']; label: string; min: number; max: number; step: number }[] = [
  { key: 'headsTall', label: 'Heads tall', min: 2, max: 9, step: 0.1 },
  { key: 'neckLength', label: 'Neck length', min: 0.3, max: 2, step: 0.05 },
  { key: 'torsoLength', label: 'Torso length', min: 0.6, max: 1.6, step: 0.05 },
  { key: 'legLength', label: 'Leg length', min: 0.6, max: 1.8, step: 0.05 },
  { key: 'armLength', label: 'Arm length', min: 0.6, max: 1.6, step: 0.05 },
  { key: 'handSize', label: 'Hand size', min: 0.6, max: 1.6, step: 0.05 },
  { key: 'footSize', label: 'Foot size', min: 0.6, max: 1.6, step: 0.05 },
  { key: 'shoulderWidth', label: 'Shoulder width', min: 0.6, max: 1.8, step: 0.05 },
  { key: 'hipWidth', label: 'Hip width', min: 0.6, max: 1.8, step: 0.05 },
];

const TOUCH_SIDES: TouchSide[] = ['nearest', 'front', 'back', 'left', 'right'];
const HAND_SIDES: { side: HandSide; label: string }[] = [
  { side: 'both', label: 'Both hands' },
  { side: 'l', label: 'Left hand' },
  { side: 'r', label: 'Right hand' },
];

const LIGHT_KINDS: { kind: LightKind; label: string }[] = [
  { kind: 'sun', label: 'Sun' },
  { kind: 'spot', label: 'Spot' },
  { kind: 'point', label: 'Lamp' },
  { kind: 'ambient', label: 'Ambient' },
];

const BUILD_SLIDERS: { key: keyof CharacterProfile['build']; label: string; min: number; max: number; step: number }[] = [
  { key: 'weight', label: 'Weight (thin – heavy)', min: -1, max: 1, step: 0.05 },
  { key: 'muscle', label: 'Muscle', min: 0, max: 1, step: 0.05 },
  { key: 'chest', label: 'Chest', min: 0, max: 1, step: 0.05 },
];
// #endregion

// #region Main flow
interface PanelProps {
  characters: SceneCharacter[];
  sceneProps: PropEntry[];
  lights: LightEntry[];
  background: string;
  selected: SceneCharacter | null;
  selectedControl: string | null;
  selectedLightId: string | null;
  selectedPropId: string | null;
  mode: Mode;
  onChangeMode: (mode: Mode) => void;
  onSelectCharacter: (id: string) => void;
  onSelectControl: (control: string | null) => void;
  onSelectLight: (id: string | null) => void;
  onSelectProp: (id: string | null) => void;
  onChangeProps: (update: (props: PropEntry[]) => PropEntry[], key: string) => void;
  views: CameraView[];
  lensMm: number;
  onChangeLens: (lensMm: number) => void;
  getCameraView: () => CameraView | null;
  onGoToView: (view: CameraView) => void;
  onChangeViews: (update: (views: CameraView[]) => CameraView[], key: string) => void;
  onLookFrom: (view: ViewName) => void;
  onFrameAll: () => void;
  isFrontView: boolean;
  onToggleFrontView: () => void;
  isPinFeet: boolean;
  onTogglePinFeet: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onTravel: (direction: 'undo' | 'redo') => void;
  onOpenHelp: () => void;
  isCardFolded: boolean;
  pins: Pin[];
  onTogglePin: (pin: Pin) => void;
  onFoldCard: (isFolded: boolean) => void;
  onUpdateCharacter: (id: string, change: Partial<SceneCharacter>) => void;
  onChangeLights: (update: (lights: LightEntry[]) => LightEntry[], key: string) => void;
  onChangeBackground: (color: string) => void;
  onExport: (request: ExportRequest) => void;
  onReplaceScene: (scene: SceneState, camera?: CameraView) => void;
  onAddCharacter: (profile: CharacterProfile) => void;
  onRemoveCharacter: (id: string) => void;
  onStartTouchPick: (part: string) => void;
  onHoldHands: (otherId: string) => void;
  onFixOverlaps: () => void;
  onToggleLock: (id: string) => void;
}

export function Panel(props: PanelProps) {
  const { characters, selected, selectedControl, mode } = props;
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [lockedMenu, setLockedMenu] = useState<{ id: string; left: number; top: number } | null>(null);
  const [message, setMessage] = useState('');
  const [sharedLink, setSharedLink] = useState('');
  const [isShowingMore, setIsShowingMore] = useState(() => {
    try {
      return localStorage.getItem(SHOW_MORE_STORAGE_KEY) === 'yes';
    } catch {
      return false;
    }
  });
  const [myPoses, setMyPoses] = useState<PoseFile[]>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(MY_POSES_STORAGE_KEY) ?? '[]');
      return Array.isArray(stored) ? stored : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(''), MESSAGE_MILLISECONDS);
    return () => clearTimeout(timer);
  }, [message]);

  const toggleMore = () => {
    setIsShowingMore(!isShowingMore);
    try {
      localStorage.setItem(SHOW_MORE_STORAGE_KEY, isShowingMore ? 'no' : 'yes');
    } catch {
      // Only a convenience; the toggle still works for this visit.
    }
  };

  const saveMyPoses = (poses: PoseFile[]) => {
    setMyPoses(poses);
    try {
      localStorage.setItem(MY_POSES_STORAGE_KEY, JSON.stringify(poses));
    } catch {
      setMessage('This browser would not keep the pose; use "Download pose" instead');
    }
  };

  // A library pose replaces the joint angles but keeps where the character stands and which way it faces.
  const applyPose = (file: PoseFile) => {
    if (!selected) return;
    const turn = selected.pose.joints?.pelvis?.turn;
    const joints = structuredClone(file.joints);
    if (turn) joints.pelvis = { ...joints.pelvis, turn };
    const pose: Pose = dropToFloor(buildRig(selected.profile), { ...selected.pose, joints }, props.sceneProps.flatMap(propBoxes));
    props.onUpdateCharacter(selected.id, { pose });
    setMessage(`${selected.profile.name}: ${file.name}`);
  };

  // Opened files and share links both end up here, so a link behaves exactly like opening the file.
  const openData = (data: { format?: string; name?: string }) => {
    if (data.format === 'poser.scene/1') {
      const scene = data as SceneFile;
      const camera = typeof scene.camera === 'object' && scene.camera ? (normalizeView(scene.camera) ?? undefined) : undefined;
      props.onReplaceScene({
        characters: scene.characters.map((entry) => ({ id: newCharacterId(), profile: normalizeProfile(entry.profile), pose: entry.pose ?? {}, isLocked: entry.locked === true })),
        sceneProps: (Array.isArray(scene.props) ? scene.props.filter((prop) => typeof prop === 'object' && prop) : []).map((prop) => ({ ...normalizeProp(prop), id: newPropId() })),
        // Scenes saved before lights existed get the default lights.
        lights: (Array.isArray(scene.lights) ? scene.lights.filter((light) => typeof light === 'object' && light).map(normalizeLight) : DEFAULT_LIGHTS).map((light) => ({ ...light, id: newLightId() })),
        background: /^#[0-9a-f]{6}$/i.test(scene.background ?? '') ? scene.background! : DEFAULT_BACKGROUND,
        views: (Array.isArray(scene.views) ? scene.views : []).flatMap((view) => (typeof view === 'object' && view ? (normalizeView(view) ?? []) : [])),
      }, camera);
      setMessage(`Opened scene with ${scene.characters.length} characters`);
      return;
    }
    if (data.format === 'poser.character/1') {
      props.onAddCharacter(data as CharacterProfile);
      setMessage(`Added ${data.name}`);
      return;
    }
    if (data.format === 'poser.pose/1') {
      const pose = data as PoseFile;
      saveMyPoses([...myPoses.filter((entry) => entry.name !== pose.name), pose]);
      if (!selected) {
        setMessage(`Added pose ${pose.name} to My poses`);
        return;
      }
      applyPose(pose);
      return;
    }
    setMessage('That file is not a Poser scene, character or pose');
  };

  const openFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      openData(JSON.parse(await file.text()));
    } catch (error) {
      setMessage(`Could not read ${file.name}: ${(error as Error).message}`);
    }
  };

  const latestOpenData = useRef(openData);
  latestOpenData.current = openData;

  // A share link (#scene=… or #character=…) opens once, then leaves the address bar so a reload doesn't add it again.
  useEffect(() => {
    const openSharedLink = async () => {
      const shared = readShareHash(location.hash);
      if (!shared) return;
      history.replaceState(null, '', location.pathname + location.search);
      if (typeof DecompressionStream === 'undefined') {
        setMessage('This browser is too old to open share links (Safari 16.4 or newer works); ask for the file instead');
        return;
      }
      try {
        latestOpenData.current((await unpackFromLink(shared.packed)) as { format?: string });
      } catch {
        setMessage('That share link is broken or cut off; ask for it again, or for the file');
      }
    };
    openSharedLink();
    window.addEventListener('hashchange', openSharedLink);
    return () => window.removeEventListener('hashchange', openSharedLink);
  }, []);

  const share = async (kind: SharedKind, data: object, title: string) => {
    setSharedLink('');
    let link: string;
    try {
      link = shareLink(location.href, kind, await packForLink(data));
    } catch {
      setMessage('This browser is too old to make share links; use "Save scene" and send the file');
      return;
    }
    if (link.length > MAX_SHARE_LINK_LENGTH) {
      setMessage(`This ${kind} is too big for a link (${link.length} characters); use "Save scene" and send the file`);
      return;
    }
    // Phones get their share sheet (Discord, Messages…); computers get the clipboard.
    if (navigator.share && matchMedia('(pointer: coarse)').matches) {
      try {
        await navigator.share({ title, url: link });
        setMessage('');
      } catch (error) {
        if ((error as Error).name !== 'AbortError') setSharedLink(link);
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(link);
      setMessage(`Link to ${title} copied`);
    } catch {
      setSharedLink(link);
    }
  };

  const sceneFile = (): SceneFile => {
    const camera = props.getCameraView();
    return {
      format: 'poser.scene/1',
      characters: characters.map(({ profile, pose, isLocked }) => ({ profile, pose, ...(isLocked && { locked: true }) })),
      ...(props.sceneProps.length > 0 && { props: props.sceneProps.map(({ id: _id, ...prop }) => prop) }),
      lights: props.lights.map(({ id: _id, ...light }) => light),
      background: props.background,
      ...(camera && { camera }),
      ...(props.views.length > 0 && { views: props.views }),
    };
  };

  const saveScene = () => {
    const scene = sceneFile();
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([JSON.stringify(scene, null, 2)], { type: 'application/json' }));
    link.download = 'scene.scene.json';
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const cardTitle = {
    pose: selected ? (selectedControl ? partName(selectedControl) : selected.profile.name) : 'Pose',
    library: 'Library',
    body: selected ? `${selected.profile.name}'s body` : 'Body',
    scene: 'Scene',
    camera: 'Camera',
  }[mode];
  const isEmptyCharacterMode = !selected && (mode === 'pose' || mode === 'library' || mode === 'body');

  return (
    <>
      <header className="topbar">
        <div className="topbar-group">
          <div className="menu">
            <button onClick={() => setIsMenuOpen(!isMenuOpen)} aria-expanded={isMenuOpen} aria-label="File menu" title="Open, save, share">
              ☰
            </button>
            {isMenuOpen && (
              <>
                <div className="menu-backdrop" onClick={() => setIsMenuOpen(false)} />
                <div className="menu-list" onClick={() => setIsMenuOpen(false)}>
                  <label className="button">
                    Open file…
                    <input type="file" accept=".json,application/json" onChange={openFile} hidden />
                  </label>
                  <button onClick={saveScene}>Save scene</button>
                  <button onClick={() => share('scene', sceneFile(), 'this scene')} title="Copy or send a link that opens this scene, characters and poses included">
                    Share link
                  </button>
                  <button onClick={() => setIsExportOpen(true)}>Save image…</button>
                </div>
              </>
            )}
          </div>
          <div className="character-chips">
            {characters.map((character) => (
              <button
                key={character.id}
                className={character.id === selected?.id ? 'chip is-active' : character.isLocked ? 'chip is-locked' : 'chip'}
                style={{ borderColor: character.profile.color }}
                title={character.isLocked ? `${character.profile.name} is locked` : undefined}
                onClick={(event) => {
                  if (!character.isLocked) return props.onSelectCharacter(character.id);
                  const bounds = event.currentTarget.getBoundingClientRect();
                  setLockedMenu({ id: character.id, left: bounds.left, top: bounds.bottom + 6 });
                }}
              >
                {character.isLocked && <LockIcon />}
                {character.profile.name}
              </button>
            ))}
            <button className="chip" onClick={() => props.onAddCharacter(DEFAULT_PROFILE)} title="Add a mannequin" aria-label="Add a mannequin">
              +
            </button>
          </div>
        </div>
        <div className="topbar-group">
          {props.isFrontView && (
            <button className="is-active" onClick={props.onToggleFrontView}>
              Back to 3D
            </button>
          )}
          <button onClick={() => props.onTravel('undo')} disabled={!props.canUndo} title="Undo (Ctrl/Cmd Z)" aria-label="Undo">
            ↶
          </button>
          <button onClick={() => props.onTravel('redo')} disabled={!props.canRedo} title="Redo (Ctrl/Cmd Shift Z)" aria-label="Redo">
            ↷
          </button>
          <button onClick={props.onOpenHelp} title="Mouse, touch and keyboard shortcuts (?)" aria-label="Shortcuts">
            ?
          </button>
        </div>
      </header>

      {lockedMenu && (() => {
        const character = characters.find((entry) => entry.id === lockedMenu.id);
        if (!character) return null;
        return (
          <>
            <div className="menu-backdrop" onClick={() => setLockedMenu(null)} />
            <div className="menu-list part-menu" style={{ left: Math.min(lockedMenu.left, window.innerWidth - 230), top: lockedMenu.top }} role="menu">
              <strong>{character.profile.name} is locked</strong>
              <button
                onClick={() => {
                  props.onToggleLock(character.id);
                  setLockedMenu(null);
                }}
              >
                Unlock {character.profile.name}
              </button>
              <button
                className="danger"
                onClick={() => {
                  props.onRemoveCharacter(character.id);
                  setLockedMenu(null);
                }}
              >
                Remove {character.profile.name}
              </button>
            </div>
          </>
        );
      })()}

      {(message || sharedLink) && (
        <div className="toast" role="status">
          {message && <span>{message}</span>}
          {sharedLink && (
            <label className="field">
              Copy this link:
              <input readOnly value={sharedLink} onFocus={(event) => event.currentTarget.select()} />
            </label>
          )}
          {sharedLink && <button onClick={() => setSharedLink('')}>Done</button>}
        </div>
      )}

      <nav className="modes" aria-label="Modes">
        {MODES.map((entry) => (
          <button
            key={entry.mode}
            className={entry.mode === mode ? 'is-active' : ''}
            aria-pressed={entry.mode === mode}
            onClick={() => {
              props.onChangeMode(entry.mode);
              props.onFoldCard(false);
            }}
          >
            {entry.label}
          </button>
        ))}
      </nav>

      <aside className={props.isCardFolded ? 'card is-collapsed' : 'card'} aria-label={cardTitle}>
        <header className="card-header">
          <strong>{cardTitle}</strong>
          <button className="card-toggle" onClick={() => props.onFoldCard(!props.isCardFolded)} aria-label={props.isCardFolded ? 'Show the card' : 'Fold the card away'}>
            {props.isCardFolded ? '▴' : '▾'}
          </button>
        </header>
        <div className="card-body">
          <Guide />
          {isEmptyCharacterMode && (
            <>
              {characters.length === 0 ? <p className="hint">No character yet.</p> : <p className="hint">Pick a character: tap its name at the top, or click it on the stage.</p>}
              <button onClick={() => props.onAddCharacter(DEFAULT_PROFILE)}>Add a mannequin</button>
            </>
          )}
          {selected && mode === 'pose' && <PoseCard {...props} selected={selected} isShowingMore={isShowingMore} onToggleMore={toggleMore} />}
          {selected && mode === 'library' && <LibraryCard {...props} selected={selected} myPoses={myPoses} onApplyPose={applyPose} onSaveMyPoses={saveMyPoses} />}
          {selected && mode === 'body' && <BodyCard {...props} selected={selected} onShareCharacter={() => share('character', selected.profile, selected.profile.name)} />}
          {mode === 'scene' && (
            <>
              <PropsEditor {...props} />
              <LightsEditor {...props} />
            </>
          )}
          {mode === 'camera' && <CameraEditor {...props} />}
        </div>
      </aside>

      {isExportOpen && (
        <div className="dialog-backdrop" onClick={() => setIsExportOpen(false)}>
          <div className="dialog" role="dialog" aria-label="Save image" onClick={(event) => event.stopPropagation()}>
            <header>
              <strong>Save image</strong>
              <button onClick={() => setIsExportOpen(false)}>Close</button>
            </header>
            <ImageExport
              onExport={(request) => {
                setIsExportOpen(false);
                props.onExport(request);
              }}
            />
          </div>
        </div>
      )}
    </>
  );
}

interface PoseCardProps extends PanelProps {
  selected: SceneCharacter;
  isShowingMore: boolean;
  onToggleMore: () => void;
}

function PoseCard(props: PoseCardProps) {
  const { selected, selectedControl, onSelectControl, onUpdateCharacter, isShowingMore } = props;
  const { profile, pose } = selected;
  const position = pose.position ?? [0, 0, 0];
  const joints = pose.joints ?? {};
  const control = selectedControl ? CONTROLS[selectedControl] : null;
  const side = selectedControl?.match(/_(l|r)$/)?.[1] as 'l' | 'r' | undefined;
  const isHandPart = !!selectedControl && /^(wrist|thumb|index|middle|ring|pinky)_/.test(selectedControl);
  const isLegPart = !!selectedControl && /^(hip|knee|ankle|toes)_/.test(selectedControl);
  const pin = side && isHandPart ? (`hand_${side}` as Pin) : side && /^(ankle|toes)_/.test(selectedControl ?? '') ? (`foot_${side}` as Pin) : null;
  const pinWord = pin?.startsWith('hand') ? 'Hand' : 'Foot';

  const setPose = (change: Partial<Pose>) => onUpdateCharacter(selected.id, { pose: { ...pose, ...change } });
  const setMotion = (controlName: string, motion: string, degrees: number) =>
    setPose({ joints: { ...joints, [controlName]: { ...joints[controlName], [motion]: degrees } } });

  return (
    <>
      {control && selectedControl ? (
        <>
          {Object.entries(control.motions).map(([motionName, motion]) => {
            const words = motionWords(selectedControl, motionName);
            return (
              <Slider
                key={motionName}
                label={words.label}
                ends={[words.low, words.high]}
                unit="°"
                isShowingValue={isShowingMore}
                min={motion.min}
                max={motion.max}
                step={1}
                value={joints[selectedControl]?.[motionName] ?? 0}
                onChange={(degrees) => setMotion(selectedControl, motionName, degrees)}
              />
            );
          })}
          {isHandPart && side && (
            <>
              <h3>Hand shape</h3>
              <div className="tiles">
                {Object.entries(HAND_SHAPES).map(([name, shape]) => (
                  <Tile key={name} label={shape.label} request={handPicture(profile, name)} onClick={() => setPose(applyHandShape(pose, side, name))} />
                ))}
              </div>
            </>
          )}
          <div className="row">
            <button
              onClick={() => {
                const { [selectedControl]: _removed, ...rest } = joints;
                setPose({ joints: rest });
              }}
              title="Key R"
            >
              Reset this part
            </button>
            {side && (
              <button onClick={() => setPose(copyLimbToOtherSide(pose, selectedControl))} title="Key M">
                Copy this {isLegPart ? 'leg' : 'arm'} to the other side
              </button>
            )}
            {pin && (
              <button className={props.pins.includes(pin) ? 'is-active' : ''} aria-pressed={props.pins.includes(pin)} onClick={() => props.onTogglePin(pin)} title="A pinned hand or foot stays where it is while the rest of the body moves (key P)">
                {props.pins.includes(pin) ? `${pinWord} pinned` : `Pin this ${pinWord.toLowerCase()}`}
              </button>
            )}
            {selectedControl === 'pelvis' && (
              <button className={props.isPinFeet ? 'is-active' : ''} aria-pressed={props.isPinFeet} onClick={props.onTogglePinFeet} title="When on, dragging the hips bends the legs and keeps the feet where they are (key P)">
                {props.isPinFeet ? 'Feet pinned' : 'Pin feet'}
              </button>
            )}
            <button onClick={() => onSelectControl(null)} title="Key Esc">
              Done
            </button>
          </div>
          <h3>Touch</h3>
          <div className="row">
            <button onClick={() => props.onStartTouchPick(partForControl(selectedControl))} title="Then click the body part to touch, on any character">
              Touch another part…
            </button>
            {isHandPart &&
              props.characters
                .filter((other) => other.id !== selected.id)
                .map((other) => (
                  <button key={other.id} onClick={() => props.onHoldHands(other.id)}>
                    Hold hands with {other.profile.name}
                  </button>
                ))}
          </div>
        </>
      ) : (
        <>
          <p className="hint card-hint">Drag any body part to pose it. Drag a ring to twist or turn. Right-click or hold a part for more.</p>
          <div className="row">
            <button onClick={() => setPose({ joints: joints.pelvis?.turn ? { pelvis: { turn: joints.pelvis.turn } } : {} })} title="Key Shift R">
              Reset pose
            </button>
            <button onClick={() => setPose(mirrorPose(pose, 'flip'))} title="Swap left and right (key X)">
              Flip
            </button>
            <button onClick={() => setPose(dropToFloor(buildRig(profile), pose, props.sceneProps.flatMap(propBoxes)))} title="Move up or down until the lowest body part touches the floor, or a seat or step just under it (key G)">
              Drop to floor
            </button>
            <button className={props.isPinFeet ? 'is-active' : ''} aria-pressed={props.isPinFeet} onClick={props.onTogglePinFeet} title="When on, dragging the hips bends the legs and keeps the feet where they are (key P)">
              {props.isPinFeet ? 'Feet pinned' : 'Pin feet'}
            </button>
            <button onClick={props.onFixOverlaps} title="Bend arms and legs out of any body they sink into">
              Pull sunk-in parts out
            </button>
          </div>
          <div className="row">
            <button onClick={() => props.onToggleLock(selected.id)} title="A locked character can't be clicked or moved until you unlock it from its name at the top (key L)">
              Lock {profile.name}
            </button>
            <button className="danger" onClick={() => props.onRemoveCharacter(selected.id)} title="Key Delete; undo brings it back">
              Remove {profile.name}
            </button>
          </div>
          <h3>Both hands</h3>
          <div className="tiles">
            {Object.entries(HAND_SHAPES).map(([name, shape]) => (
              <Tile key={name} label={shape.label} request={handPicture(profile, name)} onClick={() => setPose(applyHandShape(pose, 'both', name))} />
            ))}
          </div>
          <TouchEditor key={selected.id} characters={props.characters} selected={selected} onUpdateCharacter={onUpdateCharacter} />
        </>
      )}

      {isShowingMore && (
        <section className="card-section">
          <h3>Body part</h3>
          <select value={selectedControl ?? ''} onChange={(event) => onSelectControl(event.target.value || null)} aria-label="Body part">
            <option value="">— whole body —</option>
            {Object.keys(CONTROLS).map((name) => (
              <option key={name} value={name}>
                {partName(name)}
              </option>
            ))}
          </select>
          <div className="row">
            <button onClick={() => setPose(mirrorPose(pose, 'left-to-right'))} title="Copy the left arm and leg onto the right">
              Mirror L → R
            </button>
            <button onClick={() => setPose(mirrorPose(pose, 'right-to-left'))} title="Copy the right arm and leg onto the left">
              Mirror R → L
            </button>
          </div>
          <h3>Place</h3>
          <Slider label="left / right" unit=" m" min={-5} max={5} step={0.01} value={position[0]} onChange={(x) => setPose({ position: [x, position[1], position[2]] })} />
          <Slider label="back / front" unit=" m" min={-5} max={5} step={0.01} value={position[2]} onChange={(z) => setPose({ position: [position[0], position[1], z] })} />
          <Slider label="up / down" unit=" m" min={-1.5} max={2} step={0.01} value={position[1]} onChange={(y) => setPose({ position: [position[0], y, position[2]] })} />
          <Slider label="turn around" unit="°" min={-180} max={180} step={1} value={joints.pelvis?.turn ?? 0} onChange={(degrees) => setMotion('pelvis', 'turn', degrees)} />
        </section>
      )}
      <button className="more-toggle" onClick={props.onToggleMore} aria-expanded={isShowingMore}>
        {isShowingMore ? 'Less' : 'More: numbers, body part list, place'}
      </button>
    </>
  );
}

interface LibraryCardProps extends PanelProps {
  selected: SceneCharacter;
  myPoses: PoseFile[];
  onApplyPose: (file: PoseFile) => void;
  onSaveMyPoses: (poses: PoseFile[]) => void;
}

function LibraryCard({ selected, onUpdateCharacter, myPoses, onApplyPose, onSaveMyPoses }: LibraryCardProps) {
  const { profile, pose } = selected;
  const joints = pose.joints ?? {};
  const [poseName, setPoseName] = useState('');
  const [handSide, setHandSide] = useState<HandSide>('both');

  // The heading is where the character faces in the scene, not part of the pose itself.
  const currentPoseFile = (name: string): PoseFile => {
    const { pelvis, ...rest } = structuredClone(joints);
    const { turn: _heading, ...pelvisTilt } = pelvis ?? {};
    return { format: 'poser.pose/1', name, joints: Object.keys(pelvisTilt).length > 0 ? { ...rest, pelvis: pelvisTilt } : rest };
  };

  const downloadPose = () => {
    const file = currentPoseFile(poseName.trim() || `${profile.name} pose`);
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }));
    link.download = `${file.name.toLowerCase().replace(/\s+/g, '-')}.pose.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <>
      <p className="hint">Tap a pose to put {profile.name} in it. It keeps its place and the way it faces.</p>
      <div className="tiles">
        {PRESET_POSES.map((file) => (
          <Tile key={file.name} label={file.name} request={posePicture(profile, file.joints)} onClick={() => onApplyPose(file)} />
        ))}
      </div>

      <h3>My poses</h3>
      {myPoses.length === 0 && <p className="hint">None yet. Pose a character, name it below and save it.</p>}
      <div className="tiles">
        {myPoses.map((file) => (
          <span key={file.name} className="tile-with-remove">
            <Tile label={file.name} request={posePicture(profile, file.joints)} onClick={() => onApplyPose(file)} />
            <button className="tile-remove danger" title={`Forget ${file.name}`} aria-label={`Forget ${file.name}`} onClick={() => onSaveMyPoses(myPoses.filter((entry) => entry.name !== file.name))}>
              ✕
            </button>
          </span>
        ))}
      </div>
      <label className="field">
        Pose name
        <input value={poseName} placeholder={`${profile.name} pose`} onChange={(event) => setPoseName(event.target.value)} />
      </label>
      <div className="row">
        <button
          onClick={() => {
            const file = currentPoseFile(poseName.trim() || `${profile.name} pose`);
            onSaveMyPoses([...myPoses.filter((entry) => entry.name !== file.name), file]);
            setPoseName('');
          }}
        >
          Save to My poses
        </button>
        <button onClick={downloadPose}>Download pose</button>
      </div>

      <h3>Hands</h3>
      <div className="row">
        <select value={handSide} onChange={(event) => setHandSide(event.target.value as HandSide)} aria-label="Which hand">
          {HAND_SIDES.map(({ side, label }) => (
            <option key={side} value={side}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div className="tiles">
        {Object.entries(HAND_SHAPES).map(([name, shape]) => (
          <Tile key={name} label={shape.label} request={handPicture(profile, name)} onClick={() => onUpdateCharacter(selected.id, { pose: applyHandShape(pose, handSide, name) })} />
        ))}
      </div>
    </>
  );
}

interface BodyCardProps extends PanelProps {
  selected: SceneCharacter;
  onShareCharacter: () => void;
}

function BodyCard({ selected, onUpdateCharacter, onRemoveCharacter, onShareCharacter, isFrontView, onToggleFrontView }: BodyCardProps) {
  const { profile } = selected;
  const setProfile = (change: Partial<CharacterProfile>) => onUpdateCharacter(selected.id, { profile: { ...profile, ...change } });

  const downloadProfile = () => {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([JSON.stringify(profile, null, 2)], { type: 'application/json' }));
    link.download = `${profile.name.toLowerCase().replace(/\s+/g, '-')}.oc.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const pickReference = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (selected.reference) URL.revokeObjectURL(selected.reference.url);
    onUpdateCharacter(selected.id, { reference: { url: URL.createObjectURL(file), opacity: selected.reference?.opacity ?? 0.6 } });
  };

  return (
    <>
      <label className="field">
        Name
        <input value={profile.name} onChange={(event) => setProfile({ name: event.target.value })} />
      </label>
      <label className="field">
        Color
        <input type="color" value={profile.color} onChange={(event) => setProfile({ color: event.target.value })} />
      </label>
      <Slider label="Height" unit=" cm" min={50} max={260} step={1} value={profile.heightCm} onChange={(heightCm) => setProfile({ heightCm })} />
      {PROPORTION_SLIDERS.map((slider) => (
        <Slider
          key={slider.key}
          label={slider.label}
          min={slider.min}
          max={slider.max}
          step={slider.step}
          value={profile.proportions[slider.key]}
          onChange={(value) => setProfile({ proportions: { ...profile.proportions, [slider.key]: value } })}
        />
      ))}
      {BUILD_SLIDERS.map((slider) => (
        <Slider key={slider.key} label={slider.label} min={slider.min} max={slider.max} step={slider.step} value={profile.build[slider.key]} onChange={(value) => setProfile({ build: { ...profile.build, [slider.key]: value } })} />
      ))}

      <h3>Reference image</h3>
      <p className="hint">A sprite cropped from the top of the head to the feet. It is scaled to the character's height and placed behind it; the flat front view lines them up.</p>
      <div className="row">
        <label className="button">
          Choose image
          <input type="file" accept="image/*" onChange={pickReference} hidden />
        </label>
        <button className={isFrontView ? 'is-active' : ''} aria-pressed={isFrontView} onClick={onToggleFrontView}>
          Flat front view
        </button>
      </div>
      {selected.reference && (
        <>
          <Slider label="Opacity" min={0.1} max={1} step={0.05} value={selected.reference.opacity} onChange={(opacity) => onUpdateCharacter(selected.id, { reference: { ...selected.reference!, opacity } })} />
          <button
            onClick={() => {
              URL.revokeObjectURL(selected.reference!.url);
              onUpdateCharacter(selected.id, { reference: undefined });
            }}
          >
            Remove image
          </button>
        </>
      )}

      <h3>Keep or share</h3>
      <div className="row">
        <button onClick={downloadProfile}>Download character</button>
        <button onClick={onShareCharacter}>Share link</button>
        <button className="danger" onClick={() => onRemoveCharacter(selected.id)}>
          Remove {profile.name}
        </button>
      </div>
    </>
  );
}

// Touching and overlaps run the solver in core/body.ts; overlaps are only checked while this section is open.
function TouchEditor({ characters, selected, onUpdateCharacter }: { characters: SceneCharacter[]; selected: SceneCharacter; onUpdateCharacter: PanelProps['onUpdateCharacter'] }) {
  const [isOpen, setIsOpen] = useState(false);
  const [part, setPart] = useState('hand_r');
  const [targetId, setTargetId] = useState(selected.id);
  const [targetPart, setTargetPart] = useState('knee_l');
  const [side, setSide] = useState<TouchSide>('nearest');
  const [result, setResult] = useState('');
  const posed: PosedCharacter[] = characters.map((character) => ({ name: character.profile.name, rig: buildRig(character.profile), pose: character.pose }));
  const index = characters.findIndex((character) => character.id === selected.id);
  const targetIndex = Math.max(0, characters.findIndex((character) => character.id === targetId));
  const overlaps = isOpen ? findOverlaps(posed).filter((overlap) => overlap.character === index || overlap.otherCharacter === index) : [];
  const partLabel = (name: string) => BODY_PARTS[name]?.label.toLowerCase() ?? name.replace(/_/g, ' ');

  const [isWorking, setIsWorking] = useState(false);

  // Bending the whole body over takes a second or more on a phone; show that before the page freezes for the solve.
  const touchNow = () => {
    setIsWorking(true);
    setResult('Bending…');
    setTimeout(() => {
      try {
        const touched = touch(posed, index, part, targetIndex, targetPart, side);
        onUpdateCharacter(selected.id, { pose: touched.pose });
        const gap = Math.round(Math.abs(touched.gapMeters) * 100);
        if (gap < 1) setResult('Touching.');
        else if (touched.gapMeters < 0) setResult(`Ended ${gap} cm inside; the joints can't pull back further. Try another side.`);
        else setResult(`Got within ${gap} cm; the joints can't reach further. Move the character closer and try again.`);
      } catch (error) {
        setResult((error as Error).message);
      }
      setIsWorking(false);
    }, 50);
  };

  return (
    <details onToggle={(event) => setIsOpen(event.currentTarget.open)}>
      <summary>Touch another body part</summary>
      <label className="field">
        Put the
        <select value={part} onChange={(event) => setPart(event.target.value)}>
          {Object.entries(BODY_PARTS).map(([name, bodyPart]) => (
            <option key={name} value={name}>
              {bodyPart.label}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        on
        <select value={characters[targetIndex]?.id ?? selected.id} onChange={(event) => setTargetId(event.target.value)}>
          {characters.map((character) => (
            <option key={character.id} value={character.id}>
              {character.id === selected.id ? `${character.profile.name} (itself)` : character.profile.name}
            </option>
          ))}
        </select>
      </label>
      <div className="row">
        <select value={targetPart} onChange={(event) => setTargetPart(event.target.value)} aria-label="Body part to touch">
          {Object.entries(BODY_PARTS).map(([name, bodyPart]) => (
            <option key={name} value={name}>
              {bodyPart.label}
            </option>
          ))}
        </select>
        <select value={side} onChange={(event) => setSide(event.target.value as TouchSide)} aria-label="Side">
          {TOUCH_SIDES.map((name) => (
            <option key={name} value={name}>
              {name === 'nearest' ? 'nearest side' : `${name} side`}
            </option>
          ))}
        </select>
      </div>
      <div className="row">
        <button onClick={touchNow} disabled={isWorking}>
          Touch
        </button>
      </div>
      {result && <p className="hint">{result}</p>}

      <p className="hint">
        {overlaps.length === 0
          ? 'No body parts sink into each other.'
          : overlaps
              .slice(0, 4)
              .map((overlap) => {
                const owner = (characterIndex: number) => (characterIndex === index ? '' : `${characters[characterIndex].profile.name}'s `);
                return `${owner(overlap.character)}${partLabel(overlap.part)} is ${Math.max(1, Math.round(overlap.depthMeters * 100))} cm inside ${owner(overlap.otherCharacter)}${partLabel(overlap.otherPart)}`;
              })
              .join('; ')}
      </p>
      <div className="row">
        <button disabled={overlaps.length === 0} onClick={() => onUpdateCharacter(selected.id, { pose: separate(posed, index) })} title="Bend the limbs of this character out of bodies they sink into">
          Fix overlaps
        </button>
      </div>
    </details>
  );
}

function PropsEditor({ sceneProps, selected, selectedPropId, onSelectProp, onChangeProps }: PanelProps) {
  const selectedProp = sceneProps.find((prop) => prop.id === selectedPropId) ?? null;
  const updateProp = (change: Partial<PropEntry>) => {
    if (!selectedProp) return;
    onChangeProps((list) => list.map((prop) => (prop.id === selectedProp.id ? { ...prop, ...change } : prop)), `prop:${selectedProp.id}:${Object.keys(change).join()}`);
  };
  const sizeLabels = selectedProp?.kind === 'chair' || selectedProp?.kind === 'stool' ? ['Width', 'Seat height', 'Depth'] : ['Width', 'Height', 'Depth'];

  return (
    <section className="card-section">
      <h3>Props</h3>
      <p className="hint">Furniture to sit on, lean on or stand on. A seat or step appears under the selected character: pick a sitting pose and it lands on the seat. Drag a prop on the stage to move it.</p>
      <div className="row">
        {(Object.keys(PROP_KINDS) as PropKind[]).map((kind) => (
          <button
            key={kind}
            onClick={() => {
              // Seats and steps go right under the selected character (a sitting pose then lands on them), a wall behind it, a table in front.
              const [x, , z] = selected?.pose.position ?? [0, 0, 0];
              const offset = kind === 'wall' ? -0.5 : kind === 'table' ? 0.6 : 0;
              const added = { ...newProp(kind, [x, 0, z + offset]), id: newPropId() };
              onChangeProps((list) => [...list, added], 'props:add');
              onSelectProp(added.id);
            }}
          >
            + {PROP_KINDS[kind].label}
          </button>
        ))}
      </div>
      {sceneProps.length > 0 && (
        <div className="chips">
          {sceneProps.map((prop) => (
            <button key={prop.id} className={prop.id === selectedPropId ? 'chip is-active' : 'chip'} style={{ borderColor: prop.color }} onClick={() => onSelectProp(prop.id === selectedPropId ? null : prop.id)}>
              {PROP_KINDS[prop.kind].label}
            </button>
          ))}
        </div>
      )}
      {selectedProp && (
        <>
          <Slider label="left / right" unit=" m" min={-5} max={5} step={0.01} value={selectedProp.position[0]} onChange={(x) => updateProp({ position: [x, selectedProp.position[1], selectedProp.position[2]] })} />
          <Slider label="back / front" unit=" m" min={-5} max={5} step={0.01} value={selectedProp.position[2]} onChange={(z) => updateProp({ position: [selectedProp.position[0], selectedProp.position[1], z] })} />
          <Slider label="turn" unit="°" min={-180} max={180} step={1} value={selectedProp.turn} onChange={(turn) => updateProp({ turn })} />
          {sizeLabels.map((label, axis) => (
            <Slider
              key={label}
              label={label}
              unit=" m"
              min={MIN_PROP_SIZE}
              max={Math.min(MAX_PROP_SIZE, axis === 1 ? 3 : 4)}
              step={0.01}
              value={selectedProp.size[axis]}
              onChange={(value) => updateProp({ size: selectedProp.size.map((current, index) => (index === axis ? value : current)) as PropEntry['size'] })}
            />
          ))}
          <label className="field">
            Color
            <input type="color" value={selectedProp.color} onChange={(event) => updateProp({ color: event.target.value })} />
          </label>
          <div className="row">
            <button
              className="danger"
              onClick={() => {
                onChangeProps((list) => list.filter((prop) => prop.id !== selectedProp.id), 'props:remove');
                onSelectProp(null);
              }}
            >
              Remove prop
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function CameraEditor({ views, lensMm, onChangeLens, getCameraView, onGoToView, onChangeViews, onLookFrom, onFrameAll, isFrontView, onToggleFrontView, selected, lights, background }: PanelProps) {
  return (
    <>
      <p className="hint">{selected ? `Look at ${selected.profile.name} from:` : 'Look from:'}</p>
      <div className="row">
        {VIEW_BUTTONS.map(({ view, label, key }) => (
          <button key={view} disabled={!selected} onClick={() => onLookFrom(view)} title={`Key ${key}`}>
            {label}
          </button>
        ))}
      </div>
      <div className="row">
        <button onClick={onFrameAll} title="Key Shift F, or double-click empty space">
          See everyone
        </button>
        <button className={isFrontView ? 'is-active' : ''} aria-pressed={isFrontView} onClick={onToggleFrontView} title="A flat view with no perspective, to line up a reference image">
          Flat front view
        </button>
      </div>
      <h3>Lens</h3>
      <p className="hint">Lens in mm. Wide lenses stretch depth (a hand toward the camera looks huge); long ones flatten it. The characters keep their size on screen.</p>
      <div className="tiles">
        {LENS_PRESETS.map((preset) => (
          <Tile
            key={preset.lensMm}
            label={preset.label}
            isActive={Math.round(lensMm) === preset.lensMm}
            request={selected ? { ...scenePicture(selected, lights, background), lensMm: preset.lensMm, view: 'front', focus: 'portrait' } : null}
            onClick={() => onChangeLens(preset.lensMm)}
          />
        ))}
      </div>
      <Slider label="Lens" unit=" mm" min={MIN_LENS_MM} max={MAX_LENS_MM} step={1} value={Math.round(lensMm)} onChange={onChangeLens} />
      <div className="row">
        <button
          onClick={() => {
            const current = getCameraView();
            if (!current) return;
            const taken = new Set(views.map((view) => view.name));
            let number = views.length + 1;
            while (taken.has(`View ${number}`)) number += 1;
            onChangeViews((list) => [...list, { ...current, name: `View ${number}` }], 'views:add');
          }}
          title="Keep this angle and lens in the scene, to come back to it or share it"
        >
          Save this view
        </button>
      </div>
      {views.length > 0 && (
        <div className="row">
          {views.map((view) => (
            <span key={view.name} className="pose-chip">
              <button onClick={() => onGoToView(view)}>{view.name}</button>
              <button className="danger" title={`Forget ${view.name}`} onClick={() => onChangeViews((list) => list.filter((entry) => entry.name !== view.name), 'views:remove')}>
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
      <p className="hint">Saved scenes and share links open from the angle you leave the camera at.</p>
    </>
  );
}

function LightsEditor({ lights, background, selected, selectedLightId, onSelectLight, onChangeLights, onChangeBackground }: PanelProps) {
  const selectedLight = lights.find((light) => light.id === selectedLightId) ?? null;
  const updateLight = (change: Partial<LightEntry>) => {
    if (!selectedLight) return;
    onChangeLights((list) => list.map((light) => (light.id === selectedLight.id ? { ...light, ...change } : light)), `light:${selectedLight.id}:${Object.keys(change).join()}`);
  };
  const placement = selectedLight ? placementOf(selectedLight) : null;
  const place = (change: Partial<LightPlacement>) => updateLight({ position: positionFromPlacement(selectedLight!.target, { ...placement!, ...change }) });
  const labelOf = (light: LightEntry) => LIGHT_KINDS.find((entry) => entry.kind === light.kind)!.label;

  return (
    <section className="card-section">
      <h3>Lights</h3>
      <p className="hint">A preset replaces all lights:</p>
      <div className="tiles">
        {LIGHT_PRESETS.map((preset) => (
          <Tile
            key={preset.name}
            label={preset.name}
            request={selected ? scenePicture(selected, preset.lights, background) : null}
            onClick={() => {
              onChangeLights(() => preset.lights.map((light) => ({ ...light, id: newLightId() })), 'lights:preset');
              onSelectLight(null);
            }}
          />
        ))}
      </div>

      <div className="chips">
        {lights.map((light) => (
          <button
            key={light.id}
            className={light.id === selectedLightId ? 'chip is-active' : 'chip'}
            style={{ borderColor: light.color }}
            onClick={() => onSelectLight(light.id === selectedLightId ? null : light.id)}
          >
            {labelOf(light)}
          </button>
        ))}
      </div>
      <div className="row">
        {LIGHT_KINDS.map(({ kind, label }) => (
          <button
            key={kind}
            onClick={() => {
              const added = { ...newLight(kind), id: newLightId() };
              onChangeLights((list) => [...list, added], 'lights:add');
              onSelectLight(added.id);
            }}
          >
            + {label}
          </button>
        ))}
      </div>

      {selectedLight && placement && (
        <>
          <label className="field">
            Color
            <input type="color" value={selectedLight.color} onChange={(event) => updateLight({ color: event.target.value })} />
          </label>
          {selectedLight.kind === 'ambient' && (
            <label className="field">
              Floor bounce color
              <input type="color" value={selectedLight.groundColor ?? selectedLight.color} onChange={(event) => updateLight({ groundColor: event.target.value })} />
            </label>
          )}
          <Slider label="Brightness" min={0} max={MAX_INTENSITY} step={0.05} value={selectedLight.intensity} onChange={(intensity) => updateLight({ intensity })} />
          {selectedLight.kind !== 'ambient' && (
            <>
              <Slider label="Around" unit="°" min={-180} max={180} step={1} value={placement.aroundDegrees} onChange={(aroundDegrees) => place({ aroundDegrees })} />
              <Slider label="Height" unit="°" min={-30} max={89} step={1} value={placement.heightDegrees} onChange={(heightDegrees) => place({ heightDegrees })} />
              <Slider label="Distance" unit=" m" min={0.3} max={10} step={0.05} value={placement.distance} onChange={(distance) => place({ distance })} />
              <Slider
                label="Aim height"
                unit=" m"
                min={0}
                max={2.5}
                step={0.01}
                value={selectedLight.target[1]}
                onChange={(height) => {
                  const target: LightEntry['target'] = [selectedLight.target[0], height, selectedLight.target[2]];
                  updateLight({ target, position: positionFromPlacement(target, placement) });
                }}
              />
            </>
          )}
          {selectedLight.kind === 'spot' && (
            <>
              <Slider label="Cone" unit="°" min={5} max={80} step={1} value={selectedLight.coneDegrees ?? 35} onChange={(coneDegrees) => updateLight({ coneDegrees })} />
              <Slider label="Soft edge" min={0} max={1} step={0.05} value={selectedLight.softness ?? 0.4} onChange={(softness) => updateLight({ softness })} />
            </>
          )}
          <div className="row">
            {selectedLight.kind !== 'ambient' && (
              <button className={selectedLight.castShadow ? 'is-active' : ''} onClick={() => updateLight({ castShadow: !selectedLight.castShadow })}>
                Shadows {selectedLight.castShadow ? 'on' : 'off'}
              </button>
            )}
            <button
              className="danger"
              onClick={() => {
                onChangeLights((list) => list.filter((light) => light.id !== selectedLight.id), 'lights:remove');
                onSelectLight(null);
              }}
            >
              Remove light
            </button>
          </div>
        </>
      )}

      <label className="field">
        Background
        <input type="color" value={background} onChange={(event) => onChangeBackground(event.target.value)} />
      </label>
    </section>
  );
}

function ImageExport({ onExport }: { onExport: (request: ExportRequest) => void }) {
  const [scale, setScale] = useState(2);
  const [isTransparent, setIsTransparent] = useState(false);
  const [isShowingGuides, setIsShowingGuides] = useState(false);

  return (
    <>
      <p className="hint">Saves what the stage shows now, without the light markers and the selection color.</p>
      <label className="field">
        Size
        <select value={scale} onChange={(event) => setScale(Number(event.target.value))}>
          <option value={1}>Screen size</option>
          <option value={2}>2× sharper</option>
          <option value={4}>4× sharper (big file)</option>
        </select>
      </label>
      <label className="check">
        <input type="checkbox" checked={isTransparent} onChange={(event) => setIsTransparent(event.target.checked)} />
        Transparent background (keeps the floor shadows)
      </label>
      <label className="check">
        <input type="checkbox" checked={isShowingGuides} onChange={(event) => setIsShowingGuides(event.target.checked)} />
        Include floor grid and height ruler
      </label>
      <div className="row">
        <button onClick={() => onExport({ scale, isTransparent, isShowingGuides })}>Save PNG</button>
      </div>
    </>
  );
}
// #endregion

// #region Helpers
function LockIcon() {
  return (
    <svg className="lock-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4.5 7V5a3.5 3.5 0 0 1 7 0v2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor" />
    </svg>
  );
}

function posePicture(profile: CharacterProfile, joints: Pose['joints']): ThumbnailRequest {
  return { profile, pose: { joints }, lights: DEFAULT_LIGHTS, background: THUMBNAIL_BACKGROUND, view: 'three-quarter', size: THUMBNAIL_PIXELS };
}

function handPicture(profile: CharacterProfile, shapeName: string): ThumbnailRequest {
  return { ...posePicture(profile, applyHandShape({ joints: HAND_PICTURE_JOINTS }, 'r', shapeName).joints), focus: 'hand_r' };
}

// The character as posed now, without its heading, under these lights.
function scenePicture(character: SceneCharacter, lights: SceneLight[], background: string): ThumbnailRequest {
  const { pelvis, ...joints } = character.pose.joints ?? {};
  const { turn: _heading, ...pelvisTilt } = pelvis ?? {};
  return { ...posePicture(character.profile, { ...joints, pelvis: pelvisTilt }), lights, background };
}

interface SliderProps {
  label: string;
  ends?: [string, string];
  isShowingValue?: boolean;
  unit?: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
}

function Slider({ label, ends, isShowingValue = true, unit = '', min, max, step, value, onChange }: SliderProps) {
  const decimals = step < 0.1 ? 2 : step < 1 ? 1 : 0;
  return (
    <label className="slider">
      <span>
        {label.charAt(0).toUpperCase() + label.slice(1)}
        {isShowingValue && (
          <output>
            {value.toFixed(decimals)}
            {unit}
          </output>
        )}
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
      {ends && (
        <div className="slider-ends">
          <small>{ends[0]}</small>
          <small>{ends[1]}</small>
        </div>
      )}
    </label>
  );
}
// #endregion
