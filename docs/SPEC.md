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
7. ✅ Whole-body reach: when an arm (or the head) and the back can't get there, `touch` leans the whole body:
   the pelvis tilts, the legs keep the feet where they stood and the hips shift back, so a standing character
   can put a hand on its own knee or foot. A free arm that was hanging keeps hanging toward the floor.
8. ✅ Props: chair, stool, box, step, wall and table, each a few boxes; added under the selected character
   (a wall behind, a table in front), dragged over the floor or moved with sliders, sized and colored, saved in
   the scene and share links, drawn by the CLI render (`prop` adds one). "Drop to floor" and pose presets land
   on a prop top up to 25 cm above the body's lowest point, so a sitting pose settles onto the seat.
9. ✅ Camera: lens in full-frame mm (14–200, presets 24/35/50/85); a new lens moves the camera along its line of
   sight so the characters keep their size and only the perspective changes. Named views saved in the scene; the
   current view is saved with the scene and share links, so they open from the same angle. CLI: `camera` sets it,
   `render` uses it (or `--view <name>`, `--lens`).

### Interface redesign

For artists who are not technical: the stage is the tool, the panel shows one thing at a time, pictures and plain
words. Desktop with a mouse and tablet with a pencil come first. Every action must work with one button (a pen has
no wheel or middle button), so extra buttons and keys are only faster ways.

10. ✅ Quick wins in the old layout: plain-word slider labels with a word at each end (`src/app/labels.ts`; files and
    the CLI keep the anatomical names), hover highlight, a small hand or foot is grabbed whole (fingers and toes take
    over once it is 110 px on screen), double-click to look closer, shortcut keys with a "?" sheet, middle-drag and
    Alt-drag to turn the camera anywhere, zoom toward the pointer, clean view (H).
11. ✅ New shell: five modes (Pose, Library, Body, Scene, Camera) on a rail (tab bar on phones), a card that shows only
    the controls of what is selected with exact numbers behind "More", a bottom sheet on phones, files in one menu. On wider screens the picture is shifted
    (camera view offset) so the middle of the view is the middle of the space the rail and card leave free.
12. ✅ Handles on the selected character: one twist ring on the selected part, a floor ring to turn the character,
    pins per hand and foot (tinted orange; re-solved every drag frame by `holdPins`), a right-click / long-press menu.
    Grab dots on the joints were tried and removed: they cluttered the figure; the orange hover glow shows what a drag
    will move. The two-finger and both-buttons twists from the proposal were left out: two fingers already slide the
    camera, and the ring does the same with one button.
13. ✅ Pictures: thumbnails for poses (presets and My poses), hand shapes, lenses and light presets, drawn on the
    selected character's own body by the CLI ray tracer in a web worker (`src/app/thumbnails.worker.ts`), one at a time
    and cached; `src/cli/png.ts` holds the Node-only PNG encoding so `render.ts` runs in the browser too.
14. ✅ Touch by dragging: a dragged hand or foot that comes within 15 cm of a part under the pointer, or strains
    toward one it can't reach (up to 1 m), lights it up; letting go runs `touch` (the end quarter of a limb counts as
    the joint, so the lower thigh means the knee). Overlaps show as a notice on the stage with a Fix button. Three
    first-run tips replace the hint paragraph. A setting in the "?" sheet makes only a pencil pose, fingers then
    only move the camera.
15. ✅ Anatomical thumb: the base (CMC) is a saddle joint with three motions, across the palm, away from the palm,
    and a turn about its own length (opposition, about 17° in a real hand, up to 35° here), so the pad can face the
    fingers. The knuckles curl it across the palm (its nail faces sideways compared to the fingers'). A relaxed thumb
    leans about 20° from the index and 25° in front of the palm. Hand shapes were fitted so the thumb lies across the
    front of the curled fingers it holds (peace: ring and little finger; fist and point: index and middle).
    Ranges: CMC flexion/extension ~53°, abduction ~42°, rotation ~17° (Cooney 1981); MCP flexion 55–60°, IP flexion
    80–90° with ~15° over-extension (https://pmc.ncbi.nlm.nih.gov/articles/PMC4372184, https://eatonhand.com/clf/clf218.htm).
16. ✅ Touch from a selection, lock, remove. "Touch…" (Pose card and right-click menu) opens a form on the stage:
    "Put Seana's right hand on not mad's left hand", every part picked from a list so hidden or tiny parts work,
    starting on the nearest part of the nearest other character; clicking a part on the stage also picks it. A hand
    touching another character's hand holds it; there is no separate hold-hands button. Holding hands (`src/core/holding.ts`, CLI `hold`) moves both:
    the meeting point splits the distance by arm length at the lowest height both reach, one palm turns back and the
    other forward so they meet, and the fingers close. Overlaps are no longer checked while posing; "Pull sunk-in
    parts out" does it on request. A locked character ignores clicks and drags (they reach the camera or whatever is
    behind) until it is unlocked from its name chip; it can still be removed, and is saved as `locked` in scenes.
    Grip was refitted around a 4.5 cm handle crossing the palm slightly diagonally.
17. ✅ Objects list (like a drawing app's layers): Scene, Camera, then every character, prop and light, each with a
    lock, and "+ Add" for any kind. It replaces the five mode buttons and the name chips; the card follows the
    selected object (a character keeps Pose / Library / Body tabs; a prop, a light, the camera and the scene each have
    their own card). Props and lights can be locked like characters, and locks are saved in scenes. Light markers can be
    clicked and dragged (they slide at their height and keep their aim); new lamps and spots appear in view near the
    selected character. On phones the list is a strip along the bottom.
18. ✅ Fisheye, hide, focus. Fisheye is an equidistant projection reaching 75° in the picture's corners
    (`fisheyeRay` in core/camera.ts). The app draws with a very wide normal camera and bends the picture in a screen
    shader that also finishes the colors (ACES, sRGB) over the plain background; every pointer-to-ray conversion
    goes through the same bend (`src/app/fisheyeView.ts`), so posing works through it. Switching it on moves the
    camera in to the normal lens that shows the middle at the same size. The CLI traces fisheye rays directly. The
    objects list has an eye per object (hidden: not drawn, not clickable, not a seat to land on, a light is off;
    saved as `hidden`). Focus (card button, F, double-click a row) frames the selected character or part, prop, or a
    light with the spot it shines at.

## Sources

- Range of motion: https://www.physio-pedia.com/Range_of_Motion_Normative_Values, https://wikem.org/wiki/Joint_ROM_(Table)
  (ankle dorsiflexion uses the weight-bearing value, 35°, so squats and lunges are possible)
- Scapulohumeral rhythm: https://www.physio-pedia.com/Scapulohumeral_Rhythm, https://pmc.ncbi.nlm.nih.gov/articles/PMC3377910
- OC heights and silhouettes: https://soul-collection.chairwhere.com/height-chart
