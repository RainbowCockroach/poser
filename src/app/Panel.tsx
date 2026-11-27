/*
 * Edit panel: pick a character, pose its joints with anatomical sliders, mirror poses, apply poses
 * from the library, shape its body, place it, and open/save scene, character and pose files for sharing.
 * Scene-wide sections below the character: lights (presets or one by one) and saving the view as a PNG.
 * Joint sliders only allow the range a real body can do (limits live in core/pose.ts).
 * "My poses" are kept in this browser (localStorage); download a pose to share it.
 */

// #region Setup
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { CONTROLS, mirrorPose, type Pose, type PoseFile } from '../core/pose';
import { dropToFloor } from '../core/reach';
import { MAX_SHARE_LINK_LENGTH, packForLink, readShareHash, shareLink, unpackFromLink, type SharedKind } from '../core/share';
import { applyHandShape, HAND_SHAPES, type HandSide } from '../core/hands';
import { BODY_PARTS, findOverlaps, separate, touch, type PosedCharacter, type TouchSide } from '../core/body';
import { buildRig, DEFAULT_PROFILE, normalizeProfile, type CharacterProfile } from '../core/rig';
import { DEFAULT_LIGHTS, LIGHT_PRESETS, MAX_INTENSITY, newLight, normalizeLight, placementOf, positionFromPlacement, type LightKind, type LightPlacement } from '../core/lights';
import { DEFAULT_BACKGROUND, newCharacterId, newLightId, type ExportRequest, type LightEntry, type SceneCharacter, type SceneFile, type SceneState } from './App';
// #endregion

// #region Config
const PRESET_POSES = (Object.values(import.meta.glob('../../poses/*.pose.json', { eager: true, import: 'default' })) as PoseFile[]).sort((a, b) =>
  a.name.localeCompare(b.name),
);
const MY_POSES_STORAGE_KEY = 'poser.myPoses';
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
  lights: LightEntry[];
  background: string;
  selected: SceneCharacter | null;
  selectedControl: string | null;
  selectedLightId: string | null;
  onSelectCharacter: (id: string) => void;
  onSelectControl: (control: string | null) => void;
  onSelectLight: (id: string | null) => void;
  onUpdateCharacter: (id: string, change: Partial<SceneCharacter>) => void;
  onChangeLights: (update: (lights: LightEntry[]) => LightEntry[], key: string) => void;
  onChangeBackground: (color: string) => void;
  onExport: (request: ExportRequest) => void;
  onReplaceScene: (scene: SceneState) => void;
  onAddCharacter: (profile: CharacterProfile) => void;
  onRemoveCharacter: (id: string) => void;
}

export function Panel(props: PanelProps) {
  const { characters, selected, selectedControl } = props;
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [message, setMessage] = useState('');
  const [sharedLink, setSharedLink] = useState('');
  const [myPoses, setMyPoses] = useState<PoseFile[]>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(MY_POSES_STORAGE_KEY) ?? '[]');
      return Array.isArray(stored) ? stored : [];
    } catch {
      return [];
    }
  });

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
    const pose: Pose = dropToFloor(buildRig(selected.profile), { ...selected.pose, joints });
    props.onUpdateCharacter(selected.id, { pose });
    setMessage(`${selected.profile.name}: ${file.name}`);
  };

  // Opened files and share links both end up here, so a link behaves exactly like opening the file.
  const openData = (data: { format?: string; name?: string }) => {
    if (data.format === 'poser.scene/1') {
      const scene = data as SceneFile;
      props.onReplaceScene({
        characters: scene.characters.map((entry) => ({ id: newCharacterId(), profile: normalizeProfile(entry.profile), pose: entry.pose ?? {} })),
        // Scenes saved before lights existed get the default lights.
        lights: (Array.isArray(scene.lights) ? scene.lights.filter((light) => typeof light === 'object' && light).map(normalizeLight) : DEFAULT_LIGHTS).map((light) => ({ ...light, id: newLightId() })),
        background: /^#[0-9a-f]{6}$/i.test(scene.background ?? '') ? scene.background! : DEFAULT_BACKGROUND,
      });
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
    // On a phone the panel may be folded away; the result has to be seen.
    setIsCollapsed(false);
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

  const sceneFile = (): SceneFile => ({
    format: 'poser.scene/1',
    characters: characters.map(({ profile, pose }) => ({ profile, pose })),
    lights: props.lights.map(({ id: _id, ...light }) => light),
    background: props.background,
  });

  const saveScene = () => {
    const scene = sceneFile();
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([JSON.stringify(scene, null, 2)], { type: 'application/json' }));
    link.download = 'scene.scene.json';
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <aside className={`panel ${isCollapsed ? 'is-collapsed' : ''}`}>
      <header className="panel-header">
        <strong>Poser</strong>
        <div className="row">
          <label className="button">
            Open file
            <input type="file" accept=".json,application/json" onChange={openFile} hidden />
          </label>
          <button onClick={saveScene}>Save scene</button>
          <button onClick={() => share('scene', sceneFile(), 'this scene')} title="Copy or send a link that opens this scene, characters and poses included">
            Share
          </button>
          <button className="collapse-toggle" onClick={() => setIsCollapsed(!isCollapsed)}>
            {isCollapsed ? '▲' : '▼'}
          </button>
        </div>
      </header>
      {message && <p className="message">{message}</p>}
      {sharedLink && (
        <label className="field message">
          Copy this link:
          <input readOnly value={sharedLink} onFocus={(event) => event.currentTarget.select()} />
        </label>
      )}

      <div className="panel-body">
        <section>
          <div className="chips">
            {characters.map((character) => (
              <button
                key={character.id}
                className={character.id === selected?.id ? 'chip is-active' : 'chip'}
                style={{ borderColor: character.profile.color }}
                onClick={() => props.onSelectCharacter(character.id)}
              >
                {character.profile.name}
              </button>
            ))}
            <button className="chip" onClick={() => props.onAddCharacter(DEFAULT_PROFILE)}>
              + Mannequin
            </button>
          </div>
        </section>

        {selected && (
          <CharacterEditor
            {...props}
            selected={selected}
            selectedControl={selectedControl}
            myPoses={myPoses}
            onApplyPose={applyPose}
            onSaveMyPoses={saveMyPoses}
            onShareCharacter={() => share('character', selected.profile, selected.profile.name)}
          />
        )}

        <LightsEditor {...props} />
        <ImageExport onExport={props.onExport} />
      </div>
    </aside>
  );
}

interface CharacterEditorProps extends PanelProps {
  selected: SceneCharacter;
  myPoses: PoseFile[];
  onApplyPose: (file: PoseFile) => void;
  onSaveMyPoses: (poses: PoseFile[]) => void;
  onShareCharacter: () => void;
}

function CharacterEditor(props: CharacterEditorProps) {
  const { selected, selectedControl, onSelectControl, onUpdateCharacter, onRemoveCharacter, myPoses, onApplyPose, onSaveMyPoses } = props;
  const { profile, pose } = selected;
  const [poseName, setPoseName] = useState('');
  const [handSide, setHandSide] = useState<HandSide>('both');
  const position = pose.position ?? [0, 0, 0];
  const joints = pose.joints ?? {};
  const control = selectedControl ? CONTROLS[selectedControl] : null;

  const setPose = (change: Partial<typeof pose>) => onUpdateCharacter(selected.id, { pose: { ...pose, ...change } });
  const setMotion = (controlName: string, motion: string, degrees: number) =>
    setPose({ joints: { ...joints, [controlName]: { ...joints[controlName], [motion]: degrees } } });
  const setProfile = (change: Partial<CharacterProfile>) => onUpdateCharacter(selected.id, { profile: { ...profile, ...change } });

  const downloadProfile = () => {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([JSON.stringify(profile, null, 2)], { type: 'application/json' }));
    link.download = `${profile.name.toLowerCase().replace(/\s+/g, '-')}.oc.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

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

  const pickReference = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (selected.reference) URL.revokeObjectURL(selected.reference.url);
    onUpdateCharacter(selected.id, { reference: { url: URL.createObjectURL(file), opacity: selected.reference?.opacity ?? 0.6 } });
  };

  return (
    <>
      <details open>
        <summary>Pose</summary>
        <p className="hint">Drag a body part to bend it. Drag a hand or foot and the whole limb follows. Drag the hips to move the character. Or pick a joint:</p>
        <select value={selectedControl ?? ''} onChange={(event) => onSelectControl(event.target.value || null)}>
          <option value="">— choose a joint —</option>
          {Object.entries(CONTROLS).map(([name, entry]) => (
            <option key={name} value={name}>
              {entry.label}
            </option>
          ))}
        </select>
        {control &&
          selectedControl &&
          Object.entries(control.motions).map(([motionName, motion]) => (
            <Slider
              key={motionName}
              label={motionName.replace(/_/g, ' ')}
              unit="°"
              min={motion.min}
              max={motion.max}
              step={1}
              value={joints[selectedControl]?.[motionName] ?? 0}
              onChange={(degrees) => setMotion(selectedControl, motionName, degrees)}
            />
          ))}
        <div className="row">
          {selectedControl && (
            <button
              onClick={() => {
                const { [selectedControl]: _removed, ...rest } = joints;
                setPose({ joints: rest });
              }}
            >
              Reset joint
            </button>
          )}
          <button onClick={() => setPose({ joints: joints.pelvis?.turn ? { pelvis: { turn: joints.pelvis.turn } } : {} })}>Reset pose</button>
        </div>
        <div className="row">
          <button onClick={() => setPose(mirrorPose(pose, 'left-to-right'))} title="Copy the left arm and leg onto the right">
            Mirror L → R
          </button>
          <button onClick={() => setPose(mirrorPose(pose, 'right-to-left'))} title="Copy the right arm and leg onto the left">
            Mirror R → L
          </button>
          <button onClick={() => setPose(mirrorPose(pose, 'flip'))} title="Swap left and right">
            Flip
          </button>
        </div>
        <div className="row">
          <select value={handSide} onChange={(event) => setHandSide(event.target.value as HandSide)} aria-label="Which hand">
            {HAND_SIDES.map(({ side, label }) => (
              <option key={side} value={side}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="row">
          {Object.entries(HAND_SHAPES).map(([name, shape]) => (
            <button key={name} onClick={() => setPose(applyHandShape(pose, handSide, name))}>
              {shape.label}
            </button>
          ))}
        </div>
      </details>

      <TouchEditor key={selected.id} characters={props.characters} selected={selected} onUpdateCharacter={onUpdateCharacter} />

      <details>
        <summary>Pose library</summary>
        <div className="row">
          {PRESET_POSES.map((file) => (
            <button key={file.name} onClick={() => onApplyPose(file)}>
              {file.name}
            </button>
          ))}
        </div>
        <p className="hint">My poses (kept in this browser):</p>
        {myPoses.length === 0 && <p className="hint">None yet.</p>}
        <div className="row">
          {myPoses.map((file) => (
            <span key={file.name} className="pose-chip">
              <button onClick={() => onApplyPose(file)}>{file.name}</button>
              <button className="danger" title={`Forget ${file.name}`} onClick={() => onSaveMyPoses(myPoses.filter((entry) => entry.name !== file.name))}>
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
      </details>

      <details>
        <summary>Place</summary>
        <Slider label="left / right" unit=" m" min={-5} max={5} step={0.01} value={position[0]} onChange={(x) => setPose({ position: [x, position[1], position[2]] })} />
        <Slider label="back / front" unit=" m" min={-5} max={5} step={0.01} value={position[2]} onChange={(z) => setPose({ position: [position[0], position[1], z] })} />
        <Slider label="up / down" unit=" m" min={-1.5} max={2} step={0.01} value={position[1]} onChange={(y) => setPose({ position: [position[0], y, position[2]] })} />
        <Slider label="turn" unit="°" min={-180} max={180} step={1} value={joints.pelvis?.turn ?? 0} onChange={(degrees) => setMotion('pelvis', 'turn', degrees)} />
        <div className="row">
          <button onClick={() => setPose(dropToFloor(buildRig(profile), pose))} title="Move up or down until the lowest body part touches the floor">
            Drop to floor
          </button>
        </div>
      </details>

      <details>
        <summary>Body</summary>
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
        <div className="row">
          <button onClick={downloadProfile}>Download character</button>
          <button onClick={props.onShareCharacter}>Share link</button>
          <button className="danger" onClick={() => onRemoveCharacter(selected.id)}>
            Remove
          </button>
        </div>
      </details>

      <details>
        <summary>Reference image</summary>
        <p className="hint">Use a sprite cropped from the top of the head to the feet. It is scaled to the character's height and placed behind it. Use "Front view" to line them up.</p>
        <label className="button">
          Choose image
          <input type="file" accept="image/*" onChange={pickReference} hidden />
        </label>
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
      </details>
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

  const touchNow = () => {
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
  };

  return (
    <details onToggle={(event) => setIsOpen(event.currentTarget.open)}>
      <summary>Touch</summary>
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
        <button onClick={touchNow}>Touch</button>
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

function LightsEditor({ lights, background, selectedLightId, onSelectLight, onChangeLights, onChangeBackground }: PanelProps) {
  const selectedLight = lights.find((light) => light.id === selectedLightId) ?? null;
  const updateLight = (change: Partial<LightEntry>) => {
    if (!selectedLight) return;
    onChangeLights((list) => list.map((light) => (light.id === selectedLight.id ? { ...light, ...change } : light)), `light:${selectedLight.id}:${Object.keys(change).join()}`);
  };
  const placement = selectedLight ? placementOf(selectedLight) : null;
  const place = (change: Partial<LightPlacement>) => updateLight({ position: positionFromPlacement(selectedLight!.target, { ...placement!, ...change }) });
  const labelOf = (light: LightEntry) => LIGHT_KINDS.find((entry) => entry.kind === light.kind)!.label;

  return (
    <details>
      <summary>Lights</summary>
      <p className="hint">Presets replace all lights:</p>
      <div className="row">
        {LIGHT_PRESETS.map((preset) => (
          <button
            key={preset.name}
            onClick={() => {
              onChangeLights(() => preset.lights.map((light) => ({ ...light, id: newLightId() })), 'lights:preset');
              onSelectLight(null);
            }}
          >
            {preset.name}
          </button>
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
    </details>
  );
}

function ImageExport({ onExport }: { onExport: (request: ExportRequest) => void }) {
  const [scale, setScale] = useState(2);
  const [isTransparent, setIsTransparent] = useState(false);
  const [isShowingGuides, setIsShowingGuides] = useState(false);

  return (
    <details>
      <summary>Save image</summary>
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
    </details>
  );
}
// #endregion

// #region Helpers
interface SliderProps {
  label: string;
  unit?: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
}

function Slider({ label, unit = '', min, max, step, value, onChange }: SliderProps) {
  const decimals = step < 0.1 ? 2 : step < 1 ? 1 : 0;
  return (
    <label className="slider">
      <span>
        {label}
        <output>
          {value.toFixed(decimals)}
          {unit}
        </output>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}
// #endregion
