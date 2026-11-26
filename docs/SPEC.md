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
| Sharing | JSON files: `*.oc.json` (character), `*.scene.json` (scene) | Send on Discord etc.; no server needed |
| AI agents | Same core library as the app, used from a CLI and a local MCP server | Claude Code on the user's computer only |
| Output | PNG render (Blender/glTF export later, optional) | |

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
- Ball joints combine their motions as swing + twist: the swing turns by the largest angle toward the
  blend of the motions, the twist is around the segment's own axis. "Flexion 90 + abduction 90" means
  horizontal, halfway between front and side.

## Roadmap

1. ✅ Rig, limits, coupled motion, segmented body, 4 sample OCs, sliders, reference-image overlay, file save/open.
2. Direct posing: drag-to-rotate gizmos, drag hands/feet with IK, mirror pose, pose library. Touch-first.
3. Lights: point/spot/sun/ambient with color, intensity, shadows; presets. PNG export.
4. Contact solver (hand on knee, chest on back) + body collision; CLI (`poser render`) and MCP server for agents.
5. Share links (character compressed into the URL), GitHub Pages deploy, mobile polish.

## Sources

- Range of motion: https://www.physio-pedia.com/Range_of_Motion_Normative_Values, https://wikem.org/wiki/Joint_ROM_(Table)
- Scapulohumeral rhythm: https://www.physio-pedia.com/Scapulohumeral_Rhythm, https://pmc.ncbi.nlm.nih.gov/articles/PMC3377910
- OC heights and silhouettes: https://soul-collection.chairwhere.com/height-chart
