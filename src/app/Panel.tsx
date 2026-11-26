/*
 * Edit panel: pick a character, pose its joints with anatomical sliders, mirror poses, apply poses
 * from the library, shape its body, place it, and open/save scene, character and pose files for sharing.
 * Joint sliders only allow the range a real body can do (limits live in core/pose.ts).
 * "My poses" are kept in this browser (localStorage); download a pose to share it.
 */

// #region Setup
import { useState, type ChangeEvent } from 'react';
import { CONTROLS, mirrorPose, type Pose, type PoseFile } from '../core/pose';
import { dropToFloor } from '../core/reach';
import { buildRig, DEFAULT_PROFILE, normalizeProfile, type CharacterProfile } from '../core/rig';
import { newCharacterId, type SceneCharacter, type SceneFile } from './App';
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

const BUILD_SLIDERS: { key: keyof CharacterProfile['build']; label: string; min: number; max: number; step: number }[] = [
  { key: 'weight', label: 'Weight (thin – heavy)', min: -1, max: 1, step: 0.05 },
  { key: 'muscle', label: 'Muscle', min: 0, max: 1, step: 0.05 },
  { key: 'chest', label: 'Chest', min: 0, max: 1, step: 0.05 },
];
// #endregion

// #region Main flow
interface PanelProps {
  characters: SceneCharacter[];
  selected: SceneCharacter | null;
  selectedControl: string | null;
  onSelectCharacter: (id: string) => void;
  onSelectControl: (control: string | null) => void;
  onUpdateCharacter: (id: string, change: Partial<SceneCharacter>) => void;
  onReplaceScene: (characters: SceneCharacter[]) => void;
  onAddCharacter: (profile: CharacterProfile) => void;
  onRemoveCharacter: (id: string) => void;
}

export function Panel(props: PanelProps) {
  const { characters, selected, selectedControl } = props;
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [message, setMessage] = useState('');
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

  const openFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (data.format === 'poser.scene/1') {
        const scene = data as SceneFile;
        props.onReplaceScene(scene.characters.map((entry) => ({ id: newCharacterId(), profile: normalizeProfile(entry.profile), pose: entry.pose ?? {} })));
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
    } catch (error) {
      setMessage(`Could not read ${file.name}: ${(error as Error).message}`);
    }
  };

  const saveScene = () => {
    const scene: SceneFile = { format: 'poser.scene/1', characters: characters.map(({ profile, pose }) => ({ profile, pose })) };
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
          <button className="collapse-toggle" onClick={() => setIsCollapsed(!isCollapsed)}>
            {isCollapsed ? '▲' : '▼'}
          </button>
        </div>
      </header>
      {message && <p className="message">{message}</p>}

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
          />
        )}
      </div>
    </aside>
  );
}

interface CharacterEditorProps extends PanelProps {
  selected: SceneCharacter;
  myPoses: PoseFile[];
  onApplyPose: (file: PoseFile) => void;
  onSaveMyPoses: (poses: PoseFile[]) => void;
}

function CharacterEditor({ selected, selectedControl, onSelectControl, onUpdateCharacter, onRemoveCharacter, myPoses, onApplyPose, onSaveMyPoses }: CharacterEditorProps) {
  const { profile, pose } = selected;
  const [poseName, setPoseName] = useState('');
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
      </details>

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
