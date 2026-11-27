/*
 * The objects list, like the layers panel of a drawing app: the scene and the camera, then every character, prop and
 * light, each with a lock. Picking a row selects that object and the card shows what it can do. "+ Add" adds any
 * kind of object; the eye hides one; double-clicking a row frames it on the stage. A column on the left on wide
 * screens, a strip along the bottom on phones.
 */

// #region Setup
import { useState } from 'react';
import { PROP_KINDS, type PropKind } from '../core/props';
import type { LightKind } from '../core/lights';
import type { LightEntry, SceneCharacter } from './App';
import type { PropEntry } from './Props';
// #endregion

// #region Config
export type ObjectKind = 'scene' | 'camera' | 'character' | 'prop' | 'light';

export interface ObjectRef {
  kind: ObjectKind;
  id: string;
}

const LIGHT_LABELS: Record<LightKind, string> = { sun: 'Sun', spot: 'Spot', point: 'Lamp', ambient: 'Ambient' };
// #endregion

// #region Main flow
interface OutlinerProps {
  characters: SceneCharacter[];
  sceneProps: PropEntry[];
  lights: LightEntry[];
  selected: ObjectRef;
  onSelect: (object: ObjectRef) => void;
  onToggleLock: (object: ObjectRef) => void;
  onToggleHidden: (object: ObjectRef) => void;
  onFocus: (object: ObjectRef) => void;
  onAddCharacter: () => void;
  onAddProp: (kind: PropKind) => void;
  onAddLight: (kind: LightKind) => void;
}

export function Outliner({ characters, sceneProps, lights, selected, onSelect, onToggleLock, onToggleHidden, onFocus, onAddCharacter, onAddProp, onAddLight }: OutlinerProps) {
  const [isAddOpen, setIsAddOpen] = useState(false);
  const isSelected = (object: ObjectRef) => object.kind === selected.kind && (object.id === selected.id || object.kind === 'scene' || object.kind === 'camera');

  // Two props of the same kind read "Chair", "Chair 2".
  const propLabels = new Map<string, string>();
  const seenKinds = new Map<string, number>();
  for (const prop of sceneProps) {
    const count = (seenKinds.get(prop.kind) ?? 0) + 1;
    seenKinds.set(prop.kind, count);
    propLabels.set(prop.id, count === 1 ? PROP_KINDS[prop.kind].label : `${PROP_KINDS[prop.kind].label} ${count}`);
  }
  const lightLabels = new Map<string, string>();
  const seenLights = new Map<string, number>();
  for (const light of lights) {
    const count = (seenLights.get(light.kind) ?? 0) + 1;
    seenLights.set(light.kind, count);
    lightLabels.set(light.id, count === 1 ? LIGHT_LABELS[light.kind] : `${LIGHT_LABELS[light.kind]} ${count}`);
  }

  const row = (object: ObjectRef, label: string, swatch: string | null, isLocked: boolean | null, isHidden = false) => (
    <div key={`${object.kind}:${object.id}`} className={`outliner-row${isSelected(object) ? ' is-selected' : ''}${isLocked ? ' is-locked' : ''}${isHidden ? ' is-hidden' : ''}`}>
      <button className="outliner-name" onClick={() => onSelect(object)} onDoubleClick={() => onFocus(object)} aria-pressed={isSelected(object)}>
        {swatch && <span className="outliner-swatch" style={{ background: swatch }} />}
        <span>{label}</span>
      </button>
      {isLocked !== null && (
        <button
          className="outliner-eye"
          onClick={() => onToggleHidden(object)}
          aria-pressed={isHidden}
          aria-label={isHidden ? `Show ${label}` : `Hide ${label}`}
          title={isHidden ? `${label} is hidden. Click to show it.` : `Hide ${label}`}
        >
          <EyeIcon isOpen={!isHidden} />
        </button>
      )}
      {isLocked !== null && (
        <button
          className="outliner-lock"
          onClick={() => onToggleLock(object)}
          aria-pressed={isLocked}
          aria-label={isLocked ? `Unlock ${label}` : `Lock ${label}`}
          title={isLocked ? `${label} is locked: it can't be clicked or moved. Click to unlock.` : `Lock ${label} so clicks and drags pass it by`}
        >
          <LockIcon isOpen={!isLocked} />
        </button>
      )}
    </div>
  );

  return (
    <nav className="outliner" aria-label="Objects">
      <div className="outliner-head">
        <strong>Objects</strong>
        <div className="menu">
          <button onClick={() => setIsAddOpen(!isAddOpen)} aria-expanded={isAddOpen}>
            + Add
          </button>
          {isAddOpen && (
            <>
              <div className="menu-backdrop" onClick={() => setIsAddOpen(false)} />
              <div className="menu-list add-menu" onClick={() => setIsAddOpen(false)}>
                <button onClick={onAddCharacter}>Mannequin</button>
                <hr />
                {(Object.keys(PROP_KINDS) as PropKind[]).map((kind) => (
                  <button key={kind} onClick={() => onAddProp(kind)}>
                    {PROP_KINDS[kind].label}
                  </button>
                ))}
                <hr />
                {(Object.keys(LIGHT_LABELS) as LightKind[]).map((kind) => (
                  <button key={kind} onClick={() => onAddLight(kind)}>
                    {LIGHT_LABELS[kind]} light
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      <div className="outliner-rows">
        {row({ kind: 'scene', id: '' }, 'Scene', null, null)}
        {row({ kind: 'camera', id: '' }, 'Camera', null, null)}
        {characters.length > 0 && <span className="outliner-group">Characters</span>}
        {characters.map((character) => row({ kind: 'character', id: character.id }, character.profile.name, character.profile.color, character.isLocked === true, character.isHidden === true))}
        {sceneProps.length > 0 && <span className="outliner-group">Props</span>}
        {sceneProps.map((prop) => row({ kind: 'prop', id: prop.id }, propLabels.get(prop.id)!, prop.color, prop.isLocked === true, prop.isHidden === true))}
        {lights.length > 0 && <span className="outliner-group">Lights</span>}
        {lights.map((light) => row({ kind: 'light', id: light.id }, lightLabels.get(light.id)!, light.color, light.isLocked === true, light.isHidden === true))}
      </div>
    </nav>
  );
}

function EyeIcon({ isOpen }: { isOpen: boolean }) {
  return (
    <svg className="lock-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z" fill="none" stroke="currentColor" strokeWidth="1.5" />
      {isOpen ? <circle cx="8" cy="8" r="2.2" fill="currentColor" /> : <path d="M2.5 13.5l11-11" stroke="currentColor" strokeWidth="1.6" />}
    </svg>
  );
}

export function LockIcon({ isOpen = false }: { isOpen?: boolean }) {
  return (
    <svg className="lock-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d={isOpen ? 'M4.5 7V5a3.5 3.5 0 0 1 6.8-1.2' : 'M4.5 7V5a3.5 3.5 0 0 1 7 0v2'} fill="none" stroke="currentColor" strokeWidth="1.6" />
      <rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor" />
    </svg>
  );
}
// #endregion
