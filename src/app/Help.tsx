/*
 * The shortcut sheet: what the mouse, a finger or pencil, and the keyboard do on the stage.
 * Opened with the "?" button or the ? key. The keys themselves are handled in App.tsx (handleKey).
 */

// #region Config
const POINTER_ROWS: { action: string; mouse: string; touch: string }[] = [
  { action: 'Bend or move a part', mouse: 'Drag it', touch: 'Drag it with a finger or the pencil' },
  { action: 'Twist a part', mouse: 'Drag along the ring around it', touch: 'Drag along the ring around it' },
  { action: 'Turn the character', mouse: 'Drag along the ring on the floor', touch: 'Drag along the ring on the floor' },
  { action: 'Reset, copy, pin a part', mouse: 'Right-click it', touch: 'Hold it still for a moment' },
  { action: 'Make a hand touch a part', mouse: 'Drag the hand close to it; let go when it lights up', touch: 'The same' },
  { action: 'Turn the camera', mouse: 'Drag empty space, or middle-drag or Alt-drag anywhere', touch: 'Drag empty space' },
  { action: 'Slide the camera', mouse: 'Right-drag', touch: 'Drag with two fingers' },
  { action: 'Zoom', mouse: 'Scroll wheel, toward the pointer', touch: 'Pinch' },
  { action: 'Look closer at a part', mouse: 'Double-click it', touch: 'Double-tap it' },
  { action: 'See everyone', mouse: 'Double-click empty space', touch: 'Double-tap empty space' },
];

const KEY_ROWS: { keys: string[]; action: string }[] = [
  { keys: ['Ctrl/⌘ Z'], action: 'Undo (add Shift to redo)' },
  { keys: ['F'], action: 'Look closer at the selected part or character (Shift F: see everyone)' },
  { keys: ['1', '2', '3', '4'], action: 'See the character from its front, side, back, three-quarter' },
  { keys: ['R'], action: 'Reset the selected part (Shift R: the whole pose)' },
  { keys: ['M'], action: 'Copy the arm or leg of the selected part onto the other side' },
  { keys: ['X'], action: 'Flip the pose left to right' },
  { keys: ['G'], action: 'Drop to the floor' },
  { keys: ['P'], action: 'Pin the selected hand or foot (or both feet); pinned ones stay put while the rest moves' },
  { keys: ['N'], action: 'Next character' },
  { keys: ['H'], action: 'Hide the controls for a clean view to draw from' },
  { keys: ['Esc'], action: 'Deselect' },
];
// #endregion

// #region Main flow
interface HelpProps {
  isPencilOnly: boolean;
  onChangePencilOnly: (isOn: boolean) => void;
  onClose: () => void;
  onHideControls: () => void;
}

export function Help({ isPencilOnly, onChangePencilOnly, onClose, onHideControls }: HelpProps) {
  return (
    <div className="help-backdrop" onClick={onClose}>
      <div className="help" role="dialog" aria-label="Shortcuts" onClick={(event) => event.stopPropagation()}>
        <header>
          <strong>Shortcuts</strong>
          <button onClick={onClose}>Close</button>
        </header>
        <p className="hint">While a hand is small on screen, dragging it moves the whole arm. Look closer at the hand to pose single fingers.</p>
        <table>
          <thead>
            <tr>
              <th></th>
              <th>Mouse</th>
              <th>Finger or pencil</th>
            </tr>
          </thead>
          <tbody>
            {POINTER_ROWS.map((row) => (
              <tr key={row.action}>
                <th>{row.action}</th>
                <td>{row.mouse}</td>
                <td>{row.touch}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <table>
          <tbody>
            {KEY_ROWS.map((row) => (
              <tr key={row.action}>
                <th>
                  {row.keys.map((key) => (
                    <kbd key={key}>{key}</kbd>
                  ))}
                </th>
                <td>{row.action}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <label className="check">
          <input type="checkbox" checked={isPencilOnly} onChange={(event) => onChangePencilOnly(event.target.checked)} />
          Only the pencil poses; fingers just move the camera (for a tablet with a pen)
        </label>
        <div className="row">
          <button onClick={onHideControls}>Hide the controls</button>
        </div>
      </div>
    </div>
  );
}
// #endregion
