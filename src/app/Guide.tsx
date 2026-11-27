/*
 * Three short tips on the stage the first time someone opens Poser, replacing the paragraph that used to explain
 * dragging. Seen once per browser (localStorage); the "?" sheet has the full list afterwards.
 */

// #region Setup
import { useState } from 'react';
// #endregion

// #region Config
const SEEN_STORAGE_KEY = 'poser.seenGuide';
const TIPS = [
  { title: 'Drag to pose', text: 'Drag a dot, or any body part. A hand pulls the whole arm, a foot the whole leg, the square on the hips moves the body.' },
  { title: 'Twist and turn', text: 'Drag along the ring around a part to twist it. The ring on the floor turns the whole character.' },
  { title: 'More on each part', text: 'Right-click a part, or hold a finger on it, to reset, copy or pin it. Press ? (or the ? button) for every shortcut.' },
];
// #endregion

// #region Main flow
export function Guide() {
  const [step, setStep] = useState(() => {
    try {
      return localStorage.getItem(SEEN_STORAGE_KEY) === 'yes' ? TIPS.length : 0;
    } catch {
      return 0;
    }
  });
  if (step >= TIPS.length) return null;

  const finish = () => {
    setStep(TIPS.length);
    try {
      localStorage.setItem(SEEN_STORAGE_KEY, 'yes');
    } catch {
      // Without storage the tips come back next visit; nothing else depends on it.
    }
  };
  const isLast = step === TIPS.length - 1;

  return (
    <div className="guide" role="dialog" aria-label="Tips">
      <span className="guide-count">
        {step + 1} / {TIPS.length}
      </span>
      <strong>{TIPS[step].title}</strong>
      <p>{TIPS[step].text}</p>
      <div className="row">
        <button onClick={isLast ? finish : () => setStep(step + 1)} className="is-active">
          {isLast ? 'Start posing' : 'Next'}
        </button>
        {!isLast && <button onClick={finish}>Skip</button>}
      </div>
    </div>
  );
}
// #endregion
