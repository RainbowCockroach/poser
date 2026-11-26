# Poser

3D posing app for drawing reference, built for a cast of original characters with very different
bodies. Segmented art mannequins with anatomical joints and real range-of-motion limits.
Runs in the browser on desktop and phones.

```sh
npm install
npm run dev     # open the printed localhost URL
npm test        # rig and joint checks
npm run build   # static site in dist/, ready for GitHub Pages
```

- Characters: `characters/*.oc.json` load at startup. Share them, or open one with "Open file".
- Scenes: "Save scene" writes a `.scene.json` that includes its characters.
- Posing: drag a body part to bend it; drag a hand or foot to move the whole limb; drag the hips to move
  the character ("Pin feet" keeps the feet planted). Undo with Ctrl/Cmd+Z.
- Poses: presets in `poses/*.pose.json`, plus "My poses" saved in the browser and shareable as `.pose.json`.
- Spec and roadmap: `docs/SPEC.md`. For AI agents: `AGENTS.md`.
