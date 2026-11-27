# Poser

3D posing app for drawing reference, built for a cast of original characters with very different
bodies. Segmented art mannequins with anatomical joints and real range-of-motion limits.
Runs in the browser on desktop and phones: https://rainbowcockroach.github.io/poser/

```sh
npm install
npm run dev     # open the printed localhost URL
npm test        # rig and joint checks
npm run build   # static site in dist/, ready for GitHub Pages
npm run poser -- help   # CLI for agents: render, touch, check, pose (see AGENTS.md)
```

- Characters: `characters/*.oc.json` load at startup. Share them, or open one with "Open file".
- Scenes: "Save scene" writes a `.scene.json` that includes its characters.
- Share link: one link opens the whole scene (or one character, from Body) on a friend's phone or computer.
  Everything is inside the link after `#`, so nothing is uploaded.
- Layout: the ☰ menu opens, saves and shares; five modes (Pose, Library, Body, Scene, Camera) on the left
  (tabs at the bottom on phones); the card on the right shows only what the mode and the selected part need.
- Posing: drag a body part to bend it; drag a hand or foot to move the whole limb; drag the hips to move
  the character ("Pin feet" keeps the feet planted). Undo with Ctrl/Cmd+Z.
- Handles: dots on the selected character to drag, a ring to twist the selected part, a ring on the floor to turn
  the character. Right-click (or hold a finger) on a part to reset it, copy it to the other side or pin a hand or foot.
- A hand or foot that is small on screen is grabbed whole, so pulling it moves the arm or leg; double-click it
  to look closer, then single fingers can be dragged. Sliders use plain words ("Arm out to the side").
- Shortcuts: the "?" button lists them (F look closer, 1–4 views, R reset, M mirror, X flip, G drop to floor,
  H hide the controls). Middle-drag or Alt-drag turns the camera even on top of a character.
- Pictures: poses, hand shapes, lenses and light presets are tiles drawn on the selected character.
- Poses: presets in `poses/*.pose.json`, plus "My poses" saved in the browser and shareable as `.pose.json`.
- Hands: one tap for a fist, point, peace sign, grip or pinch, on one hand or both.
- Drag a hand close to a body part (or toward one it can't reach): it lights up, let go and they touch.
- Touch: put a hand on a knee or a foot (the body bends over if it has to), a chest on someone's back; "Fix overlaps" pulls limbs out of bodies.
- Props: chair, stool, box, step, wall and table; drag them around, sit or stand on them.
- Camera: pick a lens (wide 24 mm to portrait 85 mm; the characters keep their size) and save views to come back to.
- Lights: presets or your own sun, spot, lamp and ambient lights with shadows; saved in the scene.
- Save image: PNG of the current view, up to 4× sharper, optionally with a transparent background.
- Agents: `node src/cli/poser.ts` renders scenes to PNG and edits them; also an MCP server (`.mcp.json`).
- Deploy: pushing to `main` tests, builds and publishes to GitHub Pages (`.github/workflows/pages.yml`).
- Spec and roadmap: `docs/SPEC.md`. For AI agents: `AGENTS.md`.
