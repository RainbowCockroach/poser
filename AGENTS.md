# Working with Poser as an AI agent

Poser scenes and characters are plain JSON. Edit them, then open them in the app (`npm run dev`, "Open file").
A CLI renderer and MCP server are planned (see `docs/SPEC.md`); until then, check results in the app.

## Coordinates

Meters. Y is up, the ground is y = 0. A character at rest faces +Z; its left side is +X.
Rest pose: standing, arms hanging, palms facing the thighs, thumbs forward. Every angle 0 = rest.

## Character file (`characters/*.oc.json`)

```json
{
  "format": "poser.character/1",
  "name": "Bush",
  "heightCm": 110,
  "color": "#8fc48a",
  "proportions": { "headsTall": 3.6, "neckLength": 0.6, "torsoLength": 1, "legLength": 0.85, "armLength": 0.85,
                   "handSize": 0.9, "footSize": 0.9, "shoulderWidth": 0.9, "hipWidth": 1 },
  "build": { "weight": 0.1, "muscle": 0, "chest": 0 }
}
```

Multipliers are relative to a realistic adult (1 = average). `weight` is −1 (thin) to 1 (heavy).

## Scene file (`*.scene.json`)

```json
{
  "format": "poser.scene/1",
  "characters": [
    { "profile": { "...": "a character file, inline" },
      "pose": { "position": [0, 0, 0],
                "joints": { "pelvis": { "turn": 90 }, "elbow_l": { "flexion": 90 }, "knee_r": { "flexion": 45 } } } }
  ]
}
```

`position` moves the whole character (x/z on the floor, y up). Angles are degrees and are clamped to
the real human range, so asking for more than a body can do just stops at the limit.

## Pose file (`poses/*.pose.json`)

```json
{ "format": "poser.pose/1", "name": "Walk", "joints": { "hip_l": { "flexion": 25 }, "knee_r": { "flexion": 25 } } }
```

Just the joint angles, no position or heading. The presets in `poses/` are good starting points: copy their
`joints` into a scene character and adjust. In the app, applying a pose keeps the character's place and
heading, then drops it to the floor.

## Joints

The full list with limits is `LEFT_AND_MIDLINE_CONTROLS` in `src/core/pose.ts`; every `_l` control has an `_r` twin
with the same meaning (abduction is always "away from the body").

| Control | Motions (positive direction) |
|---|---|
| `pelvis` | `turn` (toward the character's left), `forward_tilt`, `side_tilt` (to its left) — moves the whole body |
| `lumbar`, `thoracic` | `flexion` (bend forward), `side_bend` (to its left), `rotation` (to its left) |
| `neck` | `flexion` (look down), `side_bend`, `rotation` (look left) |
| `shoulder_girdle_l` | `elevation` (shrug), `protraction` (shoulder forward) |
| `shoulder_l` | `flexion` (arm forward/up), `abduction` (arm out to the side/up), `internal_rotation` |
| `elbow_l` | `flexion`, `pronation` (palm turns back/down) |
| `wrist_l` | `flexion` (toward the palm), `radial_deviation` (toward the thumb) |
| `thumb_l` | `cmc_flexion`, `cmc_abduction`, `mcp_flexion`, `ip_flexion` |
| `index_l`, `middle_l`, `ring_l`, `pinky_l` | `base_flexion`, `spread`, `middle_flexion` (fingertip follows) |
| `hip_l` | `flexion` (thigh forward/up), `abduction` (leg out), `internal_rotation` |
| `knee_l` | `flexion` |
| `ankle_l` | `dorsiflexion` (toes up), `inversion` (sole inward) |
| `toes_l` | `flexion` (curl down) |

Tips: flexion and abduction on the same ball joint blend (90 + 90 = horizontal, diagonal). Raising an
arm lifts the shoulder by itself, so don't add `elevation` for that. A character that sits or kneels
needs `position[1]` lowered; in the app "Drop to floor" (Place) does it. Code that runs the core library
can call `dropToFloor(rig, pose)` and `reach(rig, pose, goals, motions)` from `src/core/reach.ts`.
