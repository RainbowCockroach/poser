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
- Posing: drag a body part to bend it; drag a hand or foot to move the whole limb; drag the hips to move
  the character ("Pin feet" keeps the feet planted). Undo with Ctrl/Cmd+Z.
- Poses: presets in `poses/*.pose.json`, plus "My poses" saved in the browser and shareable as `.pose.json`.
- Touch: put a hand on a knee, a chest on someone's back; "Fix overlaps" pulls limbs out of bodies.
- Lights: presets or your own sun, spot, lamp and ambient lights with shadows; saved in the scene.
- Save image: PNG of the current view, up to 4× sharper, optionally with a transparent background.
- Agents: `node src/cli/poser.ts` renders scenes to PNG and edits them; also an MCP server (`.mcp.json`).
- Deploy: pushing to `main` tests, builds and publishes to GitHub Pages (`.github/workflows/pages.yml`).
- Spec and roadmap: `docs/SPEC.md`. For AI agents: `AGENTS.md`.
