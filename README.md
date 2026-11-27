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
- Layout: the ☰ menu opens, saves and shares. The objects list on the left (a strip at the bottom on phones) has
  the scene, the camera and every character, prop and light, each with a lock; "+ Add" adds any of them. The card
  on the right shows what the selected object can do (a character has Pose, Library and Body tabs).
- Posing: drag a body part to bend it; drag a hand or foot to move the whole limb; drag the hips to move
  the character ("Pin feet" keeps the feet planted). Undo with Ctrl/Cmd+Z.
- Handles: a ring to twist the selected part and a ring on the floor to turn the character; pinned hands and
  feet are tinted orange. Right-click (or hold a finger) on a part to reset it, copy it to the other side or pin a hand or foot.
- A hand or foot that is small on screen is grabbed whole, so pulling it moves the arm or leg; double-click it
  to look closer, then single fingers can be dragged. Sliders use plain words ("Arm out to the side").
- Shortcuts: the "?" button lists them (F look closer, 1–4 views, R reset, M mirror, X flip, G drop to floor,
  H hide the controls). Middle-drag or Alt-drag turns the camera even on top of a character.
- Pictures: poses, hand shapes, lenses and light presets are tiles drawn on the selected character.
- Poses: presets in `poses/*.pose.json`, plus "My poses" saved in the browser and shareable as `.pose.json`.
- Hands: one tap for a fist, point, peace sign, grip or pinch, on one hand or both.
- Touch: press "Touch…" (card or right-click menu) and pick both parts from the lists, on any character, or click
  the part to touch on the stage. Or drag a hand close to a body part until it lights up and let go.
- A hand touching another character's hand holds it: both reach, palms meet and the fingers close (CLI: `hold`).
- Lock any object with its lock in the list (or L) so clicks and drags pass it by; it stays listed and can be
  unlocked or removed there. Remove the selected object with Delete or its card; undo brings it back.
- Lights: click a light's ball on the stage, or its row, and drag the ball to move it; "Show on stage" brings an
  off-screen light into view.
- The eye in the objects list hides an object (a hidden light is off). Focus (card button, F, or double-click a row)
  brings the selected object to the middle of the view.
- Camera: "Fisheye" bends the picture like a fisheye lens (strongest up close); saved images and CLI renders
  (`render --fisheye`, `camera --fisheye`) keep it.
- Touch: put a hand on a knee or a foot (the body bends over if it has to), a chest on someone's back; "Fix overlaps" pulls limbs out of bodies.
- Props: chair, stool, box, step, wall and table; drag them around, sit or stand on them.
- Camera: pick a lens (wide 24 mm to portrait 85 mm; the characters keep their size) and save views to come back to.
- Lights: presets or your own sun, spot, lamp and ambient lights with shadows; saved in the scene.
- Save image: PNG of the current view, up to 4× sharper, optionally with a transparent background.
- Agents: `node src/cli/poser.ts` renders scenes to PNG and edits them; also an MCP server (`.mcp.json`).
- Deploy: pushing to `main` tests, builds and publishes to GitHub Pages (`.github/workflows/pages.yml`).
- Spec and roadmap: `docs/SPEC.md`. For AI agents: `AGENTS.md`.
