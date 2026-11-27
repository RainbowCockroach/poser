/*
 * The touch form on the stage: "Put Seana's right hand on not mad's left hand". Both parts are picked from lists, so
 * a part hidden behind the body or too small to click still works; clicking a part on the stage picks the target.
 * Running it is App.tsx's job (touch in core/body.ts, or holding hands when a hand meets another character's hand).
 */

// #region Setup
import { BODY_PARTS, type TouchSide } from '../core/body';
import type { SceneCharacter } from './App';
// #endregion

// #region Config
export interface TouchPick {
  characterId: string;
  part: string;
  targetCharacterId: string;
  targetPart: string;
  side: TouchSide;
}

const SIDES: { side: TouchSide; label: string }[] = [
  { side: 'nearest', label: 'nearest side' },
  { side: 'front', label: 'front' },
  { side: 'back', label: 'back' },
  { side: 'left', label: 'its left' },
  { side: 'right', label: 'its right' },
];
// #endregion

// #region Main flow
interface TouchFormProps {
  characters: SceneCharacter[];
  pick: TouchPick;
  onChange: (pick: TouchPick) => void;
  onTouch: () => void;
  onCancel: () => void;
}

export function TouchForm({ characters, pick, onChange, onTouch, onCancel }: TouchFormProps) {
  const source = characters.find((character) => character.id === pick.characterId);
  if (!source) return null;
  const isHandToOtherHand = pick.part.startsWith('hand') && pick.targetPart.startsWith('hand') && pick.targetCharacterId !== pick.characterId;

  return (
    <form
      className="touch-form"
      aria-label="Touch"
      onSubmit={(event) => {
        event.preventDefault();
        onTouch();
      }}
    >
      <span>Put {source.profile.name}'s</span>
      <select id="touch-part" value={pick.part} onChange={(event) => onChange({ ...pick, part: event.target.value })} aria-label="Body part that touches">
        {Object.entries(BODY_PARTS).map(([name, part]) => (
          <option key={name} value={name}>
            {part.label.toLowerCase()}
          </option>
        ))}
      </select>
      <span>on</span>
      <select id="touch-target-character" value={pick.targetCharacterId} onChange={(event) => onChange({ ...pick, targetCharacterId: event.target.value })} aria-label="Character to touch">
        {characters.map((character) => (
          <option key={character.id} value={character.id}>
            {character.id === source.id ? `${character.profile.name} (itself)` : `${character.profile.name}'s`}
          </option>
        ))}
      </select>
      <select id="touch-target-part" value={pick.targetPart} onChange={(event) => onChange({ ...pick, targetPart: event.target.value })} aria-label="Body part to touch">
        {Object.entries(BODY_PARTS).map(([name, part]) => (
          <option key={name} value={name}>
            {part.label.toLowerCase()}
          </option>
        ))}
      </select>
      {!isHandToOtherHand && (
        <select id="touch-side" value={pick.side} onChange={(event) => onChange({ ...pick, side: event.target.value as TouchSide })} aria-label="Side of the part">
          {SIDES.map(({ side, label }) => (
            <option key={side} value={side}>
              {label}
            </option>
          ))}
        </select>
      )}
      <button type="submit" className="is-active">
        Touch
      </button>
      <button type="button" onClick={onCancel}>
        Cancel
      </button>
      <small>…or click the part to touch on the stage.</small>
    </form>
  );
}
// #endregion
