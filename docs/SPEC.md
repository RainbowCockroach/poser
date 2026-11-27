# Poser — spec

A 3D posing app for drawing reference, for a cast of original characters (OCs) with very different
bodies: chibi, tall and thin, heavy, broad. Runs in the browser on desktop and phones, hosted on
GitHub Pages. Used by one person and friends; no accounts, no server.

## Decisions

| Topic | Decision | Why |
|---|---|---|
| Look | Segmented art mannequin (rounded segments, ball joints), plain colors | Drawing reference only; segments make poses easy to read |
| Platform | Web app (React + Three.js via React Three Fiber), static build | One codebase for desktop and mobile; free hosting |
| Body | Generated in code from a small profile, not a sculpted mesh | One generator covers chibi to tall; agents can edit numbers |
| Joints | Anatomical names, real range-of-motion limits, coupled motion | Poses stay human; agents can say "elbow flexion 90" |
| Sharing | JSON files: `*.oc.json` (character), `*.scene.json` (scene), `*.pose.json` (pose), and share links (`#scene=…`, `#character=…`) | Send on Discord etc.; no server needed |
| AI agents | Same core library as the app, used from a CLI and a local MCP server | Claude Code on the user's computer only |
| Output | PNG render (Blender/glTF export later, optional) | |
| Agent render | CPU ray tracer over the mannequin shapes (`src/cli/render.ts`) | No headless browser or GPU to install |

## Body model

- Height in cm is exact. `headsTall` sets head size; the rest of the height is split between
  legs, torso and neck by a realistic 7.5-heads adult, stretched by the length multipliers.
- Widths scale from the "body unit" (the head size a realistic body of that size would have), so a
  chibi gets a big head on a small body. Short characters get slightly stockier limbs.
- Build: `weight` −1 (thin) … 1 (heavy), `muscle` 0…1, `chest` 0…1.

## Skeleton and motion

55 bones: pelvis, 2 lumbar + 2 thoracic segments, neck, head, clavicle, shoulder, elbow, wrist,
3 joints per finger, 3 thumb joints, hip, knee, ankle, toes.

Pose controls group bones the way people think about them (`lumbar`, `shoulder_l`, `index_l`…).
Each motion has a positive direction and a limit from normal range-of-motion tables (AAOS-style
values, see sources). Coupled motion:

- Spine bends spread over two segments each; neck motion spreads over neck and head (head takes most of the turning).
- Fingertip joint follows the middle finger joint at 2/3.
- Shoulder girdle rises when the arm goes past 30° (scapulohumeral rhythm, about 2:1). Shoulder
  angles stay measured against the chest.
- Dragging solves for the anatomical angles (damped least squares, `src/core/reach.ts`), so a dragged
  pose obeys the same limits and coupling as the sliders. Twists are a last resort for the solver.
- Ball joints combine their motions as swing + twist: the swing turns by the largest angle toward the
  blend of the motions, the twist is around the segment's own axis. "Flexion 90 + abduction 90" means
  horizontal, halfway between front and side.

## Roadmap

1. ✅ Rig, limits, coupled motion, segmented body, 4 sample OCs, sliders, reference-image overlay, file save/open.
2. ✅ Direct posing: drag any body part (hands and feet pull the whole limb), move the hips with or without
   pinned feet, undo/redo, mirror and flip, pose library (presets + My poses + `.pose.json` files), drop to floor.
   Twists (head turn, forearm roll, …) stay on sliders.
3. ✅ Lights: sun/spot/lamp/ambient with color, brightness, shadows, placed by angle around the target; 6 presets;
   saved in the scene file and undoable. PNG export of the current view (up to 4096 px, optional transparent
   background, helpers hidden). GitHub Pages deploy from `main`.
4. ✅ Contact: `touch` puts one body part on another (own body or another character; limbs bend, torsos slide),
   overlap check against the rest pose, "Fix overlaps". CLI (`node src/cli/poser.ts`: render, touch, check,
   separate, pose, drop) and the same commands as a stdio MCP server; `render` is a small CPU ray tracer, so it
   needs no browser or GPU. Draws on demand (phones stay cool); variance shadows on Safari/iOS.
5. ✅ Share links: a scene or one character packed into the URL hash (deflate + base64url, never sent to a
   server); phones open the share sheet, computers copy the link; `poser link` makes one from a file. Mobile
   polish: bigger invisible grab areas around hands and feet on touch screens, the first view fits every
   character on a narrow screen, 40 px touch targets, safe-area margins. Checked on an Android phone emulator
   (WebView) and the iPad and iPhone simulators.
6. ✅ Hand shapes: one tap sets a whole hand (relaxed, fist, flat, spread, point, peace, grip, pinch) on one or
   both hands, in the app and the CLI (`hand`). `render --focus hand_l` frames one body part up close.
7. Whole-body reach: when a limb alone can't get there, `touch` also bends the spine and the hips, so a
   standing character can put a hand on its own knee or reach the floor.
8. Props: simple furniture (box, chair, stool, wall, step) to sit on, lean on or stand on; placed, moved
   and turned like characters, saved in the scene, drawn by the CLI render, and "Drop to floor" lands on them.
9. Camera: lens choice (wide 24 mm to portrait 85 mm, since perspective matters for drawing) and saved
   views in the scene; the CLI renders from the saved view.

## Sources

- Range of motion: https://www.physio-pedia.com/Range_of_Motion_Normative_Values, https://wikem.org/wiki/Joint_ROM_(Table)
  (ankle dorsiflexion uses the weight-bearing value, 35°, so squats and lunges are possible)
- Scapulohumeral rhythm: https://www.physio-pedia.com/Scapulohumeral_Rhythm, https://pmc.ncbi.nlm.nih.gov/articles/PMC3377910
- OC heights and silhouettes: https://soul-collection.chairwhere.com/height-chart
