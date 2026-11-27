/*
 * Poser for agents and scripts: render a scene to PNG, find overlapping body parts, make parts touch,
 * apply poses and drop characters to the floor, editing ".scene.json" files in place.
 * The same commands run from the shell or as a local MCP server ("poser mcp", stdio), so Claude can
 * look at a render (the image comes back in the tool result) and fix the pose it sees.
 * Run: node src/cli/poser.ts help        (Node 22.18+ runs this TypeScript directly)
 * MCP: .mcp.json in the repo root registers it for Claude Code.
 */

// #region Setup
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { deflateRawSync } from 'node:zlib';
import { buildRig, normalizeProfile, type CharacterProfile } from '../core/rig.ts';
import { dropToFloor } from '../core/reach.ts';
import type { Pose, PoseFile } from '../core/pose.ts';
import { DEFAULT_LIGHTS, normalizeLight, type SceneLight } from '../core/lights.ts';
import { BODY_PARTS, findOverlaps, separate, touch, type PosedCharacter, type TouchSide } from '../core/body.ts';
import { MAX_SHARE_LINK_LENGTH } from '../core/share.ts';
import { applyHandShape, HAND_SHAPES, type HandSide } from '../core/hands.ts';
import { normalizeView, type CameraView } from '../core/camera.ts';
import { newProp, normalizeProp, PROP_KINDS, propBoxes, type PropKind, type SceneProp } from '../core/props.ts';
import { encodePng, renderScene, VIEWS, type View } from './render.ts';
// #endregion

// #region Types and config
interface SceneFile {
  format: 'poser.scene/1';
  characters: { profile: CharacterProfile; pose: Pose }[];
  props?: SceneProp[];
  lights?: SceneLight[];
  background?: string;
  camera?: CameraView;
  views?: CameraView[];
}

type Arguments = Record<string, string | boolean | undefined>;

interface CommandResult {
  text: string;
  png?: Buffer;
}

interface Command {
  summary: string;
  // Positional arguments in order, then options. Names are shared by the CLI (--name) and MCP (name).
  positional: string[];
  options: Record<string, string>;
  run: (args: Arguments) => CommandResult;
}

const VERSION = '0.7.0';
const SITE_URL = 'https://rainbowcockroach.github.io/poser/';
const DEFAULT_BACKGROUND = '#eef0f5';
const POSES_FOLDER = new URL('../../poses/', import.meta.url);
const SIDES: TouchSide[] = ['nearest', 'front', 'back', 'left', 'right'];
const ARGUMENT_HELP: Record<string, string> = {
  scene: 'path to a .scene.json file',
  character: 'character name, or its number in the scene (first is 0)',
  part: `body part: ${Object.keys(BODY_PARTS).join(', ')}`,
  target: 'character whose body is touched (name or number); default: the same character',
  target_part: 'body part that is touched (same names as part)',
  side: `which side of the target part: ${SIDES.join(', ')} (default nearest; front/back/left/right are the part's own sides)`,
  pose: 'a .pose.json path, or a preset name from poses/ (e.g. "Sit on a chair")',
  out: 'where to write; default: overwrite the scene file (PNG: next to the scene)',
  view: `${Object.keys(VIEWS).join(', ')}, "camera" (the view saved in the scene) or the name of a saved view; default: the saved camera if there is one, else three-quarter`,
  lens: 'lens in mm (24 wide … 85 portrait; default about 33) for the framed views, or the new lens for "camera"',
  position: 'camera position x,y,z in meters',
  look_at: 'point the camera looks at, x,y,z in meters (default: 1 m above the middle of the scene)',
  name: 'also keep this camera as a named view',
  width: 'image width in pixels (default 1200)',
  height: 'image height in pixels (default 900)',
  transparent: 'true for a transparent background',
  site: 'the Poser site the link opens (default: the GitHub Pages site)',
  focus: 'render a close-up of one body part (e.g. hand_l, head, foot_r) of --character (default the first)',
  shape: `hand shape: ${Object.keys(HAND_SHAPES).join(', ')}`,
  hand: 'which hand: l, r or both (default both)',
  kind: `prop: ${Object.keys(PROP_KINDS).join(', ')}`,
  x: 'left/right position on the floor in meters (default 0)',
  z: 'back/front position on the floor in meters (default 0.8, in front of a character at the middle)',
  turn: 'turn in degrees, positive toward the left (default 0: a chair\'s seat faces +Z)',
  size: 'width,height,depth in meters (chair and stool: height is the seat); default depends on the kind',
};
// #endregion

// #region Main flow
const COMMANDS: Record<string, Command> = {
  render: {
    summary: 'Render the scene to a PNG.',
    positional: ['scene'],
    options: { view: 'string', lens: 'number', width: 'number', height: 'number', out: 'string', transparent: 'boolean', focus: 'string', character: 'string' },
    run: (args) => {
      const scene = readScene(args);
      const viewName = typeof args.view === 'string' ? args.view : scene.camera ? 'camera' : 'three-quarter';
      const savedView = viewName === 'camera' ? scene.camera : scene.views?.find((entry) => entry.name?.toLowerCase() === viewName.toLowerCase());
      const isPreset = viewName in VIEWS;
      if (!isPreset && !savedView) {
        const saved = (scene.views ?? []).map((entry) => entry.name).filter(Boolean);
        throw new Error(`Unknown view "${viewName}". Known: ${[...Object.keys(VIEWS), ...(scene.camera ? ['camera'] : []), ...saved].join(', ')}`);
      }
      const view = (isPreset ? viewName : 'front') as View;
      const lensMm = args.lens === undefined ? undefined : Number(args.lens);
      const width = clampSize(args.width, 1200);
      const height = clampSize(args.height, 900);
      const rigs = scene.characters.map((entry) => buildRig(entry.profile));

      let focus: { character: number; bones: string[] } | undefined;
      if (typeof args.focus === 'string') {
        const part = BODY_PARTS[args.focus];
        if (!part) throw new Error(`Unknown body part "${args.focus}". Known: ${Object.keys(BODY_PARTS).join(', ')}`);
        const character = args.character === undefined ? 0 : characterIndex(scene, args.character);
        const side = args.focus.match(/_(l|r)$/)?.[1];
        // A hand or foot close-up includes the fingers or toes; a head close-up includes the neck.
        const belongs = (bone: string) =>
          bone === part.bone ||
          (args.focus === `hand_${side}` && new RegExp(`^(thumb|index|middle|ring|pinky)_\\d_${side}$`).test(bone)) ||
          (args.focus === `foot_${side}` && bone === `toes_${side}`) ||
          (args.focus === 'head' && bone === 'neck');
        focus = { character, bones: rigs[character].bones.map((bone) => bone.name).filter(belongs) };
      }

      const started = performance.now();
      const image = renderScene(
        {
          characters: scene.characters.map((entry, index) => ({ rig: rigs[index], pose: entry.pose })),
          props: scene.props,
          lights: scene.lights ?? DEFAULT_LIGHTS,
          background: scene.background ?? DEFAULT_BACKGROUND,
        },
        { width, height, view, focus, lensMm, camera: isPreset || focus ? undefined : { ...savedView!, lensMm: lensMm ?? savedView!.lensMm }, isTransparent: args.transparent === true || args.transparent === 'true' },
      );
      const png = encodePng(image.width, image.height, image.rgba);
      const name = (focus ? `${viewName}.${args.focus}` : viewName).replace(/[^a-z0-9.-]+/gi, '-');
      const out = typeof args.out === 'string' ? args.out : String(args.scene).replace(/(\.scene)?\.json$/, '') + `.${name}.png`;
      writeFileSync(out, png);
      return { text: `Wrote ${out} (${width}×${height}, ${viewName} view, ${Math.round(performance.now() - started)} ms)`, png };
    },
  },

  check: {
    summary: 'List body parts that sink into each other (within a character or between characters).',
    positional: ['scene'],
    options: {},
    run: (args) => {
      const scene = readScene(args);
      const posed = posedCharacters(scene);
      const overlaps = findOverlaps(posed);
      if (overlaps.length === 0) return { text: 'No overlapping body parts.' };
      const lines = overlaps.map((overlap) => {
        const first = posed[overlap.character].name;
        const second = posed[overlap.otherCharacter].name;
        return `${first} ${overlap.part} is ${Math.round(overlap.depthMeters * 100)} cm inside ${overlap.character === overlap.otherCharacter ? 'its own' : `${second}'s`} ${overlap.otherPart}`;
      });
      return { text: `${overlaps.length} overlaps:\n${lines.join('\n')}\nFix with "separate", or adjust the joints.` };
    },
  },

  touch: {
    summary: 'Bend a limb (or slide a torso) so one body part rests on another. Edits the scene file.',
    positional: ['scene', 'character', 'part', 'target_part'],
    options: { target: 'string', side: 'string', out: 'string' },
    run: (args) => {
      const scene = readScene(args);
      const posed = posedCharacters(scene);
      const index = characterIndex(scene, args.character);
      const targetIndex = args.target === undefined ? index : characterIndex(scene, args.target);
      const side = (args.side as TouchSide | undefined) ?? 'nearest';
      if (!SIDES.includes(side)) throw new Error(`Unknown side "${side}". Known: ${SIDES.join(', ')}`);
      const result = touch(posed, index, String(args.part), targetIndex, String(args.target_part), side);
      scene.characters[index].pose = result.pose;
      const out = writeScene(scene, args);
      const gapText = Math.abs(result.gapMeters) < 0.01 ? 'touching' : `still ${Math.round(Math.abs(result.gapMeters) * 100)} cm ${result.gapMeters > 0 ? 'apart' : 'inside'} (out of reach with these joint limits)`;
      return { text: `${posed[index].name} ${args.part} → ${posed[targetIndex].name} ${args.target_part}: ${gapText}. Wrote ${out}\nPose: ${JSON.stringify(result.pose)}` };
    },
  },

  separate: {
    summary: 'Push the character\'s limbs out of its own body and out of others. Edits the scene file.',
    positional: ['scene', 'character'],
    options: { out: 'string' },
    run: (args) => {
      const scene = readScene(args);
      const index = characterIndex(scene, args.character);
      scene.characters[index].pose = separate(posedCharacters(scene), index);
      const left = findOverlaps(posedCharacters(scene)).filter((overlap) => overlap.character === index || overlap.otherCharacter === index);
      const out = writeScene(scene, args);
      return { text: `${left.length === 0 ? 'No overlaps left' : `${left.length} overlaps left (limits stop the rest)`}. Wrote ${out}` };
    },
  },

  drop: {
    summary: 'Lift or lower characters so their lowest point stands on the floor, or on a prop top just under it. Edits the scene file.',
    positional: ['scene'],
    options: { character: 'string', out: 'string' },
    run: (args) => {
      const scene = readScene(args);
      const indexes = args.character === undefined ? scene.characters.map((_, index) => index) : [characterIndex(scene, args.character)];
      const boxes = (scene.props ?? []).flatMap(propBoxes);
      for (const index of indexes) scene.characters[index].pose = dropToFloor(buildRig(scene.characters[index].profile), scene.characters[index].pose, boxes);
      return { text: `Dropped ${indexes.length} character(s) to the floor (or onto props). Wrote ${writeScene(scene, args)}` };
    },
  },

  pose: {
    summary: 'Apply a pose file or preset; keeps where the character stands and faces, then drops it to the floor.',
    positional: ['scene', 'character', 'pose'],
    options: { out: 'string' },
    run: (args) => {
      const scene = readScene(args);
      const index = characterIndex(scene, args.character);
      const name = String(args.pose);
      let file: PoseFile | undefined;
      if (/\.json$/.test(name)) {
        file = JSON.parse(readFileSync(name, 'utf8')) as PoseFile;
      } else {
        const presets = readdirSync(POSES_FOLDER)
          .filter((fileName) => fileName.endsWith('.pose.json'))
          .map((fileName) => JSON.parse(readFileSync(new URL(fileName, POSES_FOLDER), 'utf8')) as PoseFile);
        file = presets.find((preset) => preset.name.toLowerCase() === name.toLowerCase());
        if (!file) throw new Error(`No pose "${name}". Presets: ${presets.map((preset) => preset.name).join(', ')}`);
      }

      const character = scene.characters[index];
      const joints = structuredClone(file.joints);
      const turn = character.pose.joints?.pelvis?.turn;
      if (turn) joints.pelvis = { ...joints.pelvis, turn };
      character.pose = dropToFloor(buildRig(character.profile), { ...character.pose, joints }, (scene.props ?? []).flatMap(propBoxes));
      return { text: `${character.profile.name}: ${file.name}. Wrote ${writeScene(scene, args)}` };
    },
  },

  hand: {
    summary: 'Set a whole hand shape (fist, point, grip...) on one or both hands. Edits the scene file.',
    positional: ['scene', 'character', 'shape'],
    options: { hand: 'string', out: 'string' },
    run: (args) => {
      const scene = readScene(args);
      const index = characterIndex(scene, args.character);
      const side = (args.hand as HandSide | undefined) ?? 'both';
      if (!['l', 'r', 'both'].includes(side)) throw new Error(`Unknown hand "${side}". Use l, r or both`);
      scene.characters[index].pose = applyHandShape(scene.characters[index].pose, side, String(args.shape));
      const which = side === 'both' ? 'both hands' : side === 'l' ? 'left hand' : 'right hand';
      return { text: `${scene.characters[index].profile.name}: ${HAND_SHAPES[String(args.shape)].label.toLowerCase()} on ${which}. Wrote ${writeScene(scene, args)}` };
    },
  },

  prop: {
    summary: 'Add a prop (chair, stool, box, step, wall, table) to the scene. Edits the scene file.',
    positional: ['scene', 'kind'],
    options: { x: 'number', z: 'number', turn: 'number', size: 'string', out: 'string' },
    run: (args) => {
      const scene = readScene(args);
      const kind = String(args.kind) as PropKind;
      if (!PROP_KINDS[kind]) throw new Error(`Unknown prop "${kind}". Known: ${Object.keys(PROP_KINDS).join(', ')}`);
      const size = typeof args.size === 'string' ? args.size.split(',').map(Number) : undefined;
      if (size && (size.length !== 3 || size.some((value) => !Number.isFinite(value)))) throw new Error('--size needs three numbers: width,height,depth');
      const prop = normalizeProp({ ...newProp(kind, [Number(args.x ?? 0), 0, Number(args.z ?? 0.8)]), turn: Number(args.turn ?? 0), ...(size && { size: size as SceneProp['size'] }) });
      scene.props = [...(scene.props ?? []), prop];
      return { text: `Added ${PROP_KINDS[kind].label.toLowerCase()} at x ${prop.position[0]}, z ${prop.position[2]} (${prop.size.join(' × ')} m). Wrote ${writeScene(scene, args)}` };
    },
  },

  camera: {
    summary: 'Set the scene camera (what "render" and the app open with); --name also keeps it as a named view. Edits the scene file.',
    positional: ['scene'],
    options: { position: 'string', look_at: 'string', lens: 'number', name: 'string', out: 'string' },
    run: (args) => {
      const scene = readScene(args);
      const point = (value: unknown, label: string) => {
        const numbers = String(value).split(',').map(Number);
        if (numbers.length !== 3 || numbers.some((entry) => !Number.isFinite(entry))) throw new Error(`--${label} needs three numbers: x,y,z`);
        return numbers as CameraView['position'];
      };
      const position = args.position === undefined ? scene.camera?.position : point(args.position, 'position');
      if (!position) throw new Error('This scene has no camera yet; give --position x,y,z');
      const middle = scene.characters.length === 0 ? 0 : scene.characters.reduce((sum, entry) => sum + (entry.pose.position?.[0] ?? 0), 0) / scene.characters.length;
      const target = args.look_at === undefined ? (scene.camera?.target ?? [middle, 1, 0]) : point(args.look_at, 'look_at');
      const view = normalizeView({ position, target, lensMm: args.lens === undefined ? scene.camera?.lensMm : Number(args.lens), name: typeof args.name === 'string' ? args.name : undefined });
      if (!view) throw new Error('The camera position and the point it looks at must be apart');
      const { name, ...camera } = view;
      scene.camera = camera;
      if (name) scene.views = [...(scene.views ?? []).filter((entry) => entry.name !== name), view];
      return { text: `Camera at ${camera.position.join(', ')} looking at ${camera.target.join(', ')}, ${Math.round(camera.lensMm)} mm${name ? `, kept as "${name}"` : ''}. Wrote ${writeScene(scene, args)}` };
    },
  },

  link: {
    summary: 'Make a share link that opens the scene in the app (characters, poses and lights included).',
    positional: ['scene'],
    options: { site: 'string' },
    run: (args) => {
      // Same packing as the app (src/core/share.ts): deflate-raw, then base64url after "#scene=".
      const packed = deflateRawSync(JSON.stringify(readScene(args))).toString('base64url');
      const site = typeof args.site === 'string' ? args.site : SITE_URL;
      const link = `${site.split('#')[0]}#scene=${packed}`;
      const warning = link.length > MAX_SHARE_LINK_LENGTH ? `\nWarning: ${link.length} characters is long for chat apps; send the .scene.json file instead.` : '';
      return { text: link + warning };
    },
  },

  parts: {
    summary: 'List the body part names used by touch and check.',
    positional: [],
    options: {},
    run: () => ({ text: Object.entries(BODY_PARTS).map(([name, part]) => `${name}: ${part.label}`).join('\n') }),
  },
};

const [commandName, ...rest] = process.argv.slice(2);
if (commandName === 'mcp') {
  serveMcp();
} else if (!commandName || commandName === 'help' || !COMMANDS[commandName]) {
  console.log(`poser ${VERSION}: render and edit Poser scenes\n\nUsage: node src/cli/poser.ts <command> ...\n`);
  for (const [name, command] of Object.entries(COMMANDS)) {
    const options = Object.keys(command.options).map((option) => `[--${option} ...]`);
    console.log(`  ${[name, ...command.positional.map((argument) => `<${argument}>`), ...options].join(' ')}\n      ${command.summary}`);
  }
  console.log(`  mcp\n      Run as an MCP server on stdin/stdout.\n\nArguments:\n${Object.entries(ARGUMENT_HELP).map(([name, help]) => `  ${name}: ${help}`).join('\n')}`);
  if (commandName && commandName !== 'help') process.exitCode = 1;
} else {
  const command = COMMANDS[commandName];
  const args: Arguments = {};
  const positional: string[] = [];
  for (let index = 0; index < rest.length; index++) {
    const option = rest[index].match(/^--([a-z_-]+)(?:=(.*))?$/);
    if (!option) {
      positional.push(rest[index]);
      continue;
    }
    const name = option[1].replace(/-/g, '_');
    if (option[2] !== undefined) args[name] = option[2];
    else if (command.options[name] === 'boolean') args[name] = true;
    else args[name] = rest[++index];
  }
  command.positional.forEach((name, index) => {
    if (positional[index] !== undefined) args[name] = positional[index];
  });
  try {
    const missing = command.positional.filter((name) => args[name] === undefined);
    if (missing.length > 0) throw new Error(`Missing ${missing.map((name) => `<${name}>`).join(' ')}. Run "node src/cli/poser.ts help".`);
    console.log(command.run(args).text);
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
  }
}
// #endregion

// #region Helpers
// MCP over stdio: one JSON-RPC message per line. Only the parts Claude Code needs: initialize, tools/list, tools/call.
function serveMcp() {
  const send = (message: object) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
  const tools = Object.entries(COMMANDS).map(([name, command]) => {
    const properties: Record<string, object> = {};
    for (const argument of [...command.positional, ...Object.keys(command.options)]) {
      const type = command.options[argument] ?? 'string';
      properties[argument] = { type: type === 'number' ? 'number' : type === 'boolean' ? 'boolean' : 'string', description: ARGUMENT_HELP[argument] };
    }
    return { name, description: command.summary, inputSchema: { type: 'object', properties, required: command.positional } };
  });

  createInterface({ input: process.stdin }).on('line', (line) => {
    if (!line.trim()) return;
    let request: { id?: number | string; method: string; params?: Record<string, unknown> };
    try {
      request = JSON.parse(line);
    } catch {
      send({ id: null, error: { code: -32700, message: 'Parse error' } });
      return;
    }
    if (typeof request !== 'object' || request === null) return send({ id: null, error: { code: -32600, message: 'Invalid Request' } });
    if (request.id === undefined) return;

    if (request.method === 'initialize') {
      const protocolVersion = (request.params?.protocolVersion as string | undefined) ?? '2025-06-18';
      send({ id: request.id, result: { protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'poser', version: VERSION } } });
      return;
    }
    if (request.method === 'ping') return send({ id: request.id, result: {} });
    if (request.method === 'tools/list') return send({ id: request.id, result: { tools } });
    if (request.method !== 'tools/call') return send({ id: request.id, error: { code: -32601, message: `Unknown method ${request.method}` } });

    const name = request.params?.name as string;
    const command = COMMANDS[name];
    if (!command) return send({ id: request.id, error: { code: -32602, message: `Unknown tool ${name}` } });
    try {
      const args = Object.fromEntries(Object.entries((request.params?.arguments ?? {}) as Record<string, unknown>).map(([key, value]) => [key, typeof value === 'boolean' ? value : String(value)]));
      const result = command.run(args);
      const content: object[] = [{ type: 'text', text: result.text }];
      if (result.png) content.push({ type: 'image', data: result.png.toString('base64'), mimeType: 'image/png' });
      send({ id: request.id, result: { content } });
    } catch (error) {
      send({ id: request.id, result: { content: [{ type: 'text', text: (error as Error).message }], isError: true } });
    }
  });
}

function readScene(args: Arguments): SceneFile {
  const path = String(args.scene);
  const data = JSON.parse(readFileSync(path, 'utf8'));
  if (data.format !== 'poser.scene/1' || !Array.isArray(data.characters)) throw new Error(`${path} is not a poser.scene/1 file`);
  return {
    ...data,
    characters: data.characters.map((entry: { profile?: Partial<CharacterProfile>; pose?: Pose }) => ({ ...entry, profile: normalizeProfile(entry.profile ?? {}), pose: entry.pose ?? {} })),
    camera: typeof data.camera === 'object' && data.camera ? (normalizeView(data.camera) ?? undefined) : undefined,
    views: Array.isArray(data.views) ? data.views.map((view: Partial<CameraView>) => (typeof view === 'object' && view ? normalizeView(view) : null)).filter(Boolean) : undefined,
    props: Array.isArray(data.props) ? data.props.filter((prop: unknown) => typeof prop === 'object' && prop).map(normalizeProp) : undefined,
    lights: Array.isArray(data.lights) ? data.lights.filter((light: unknown) => typeof light === 'object' && light).map(normalizeLight) : undefined,
    background: /^#[0-9a-f]{6}$/i.test(data.background ?? '') ? data.background : undefined,
  };
}

function writeScene(scene: SceneFile, args: Arguments): string {
  const out = typeof args.out === 'string' ? args.out : String(args.scene);
  writeFileSync(out, JSON.stringify(scene, null, 2) + '\n');
  return out;
}

function posedCharacters(scene: SceneFile): PosedCharacter[] {
  return scene.characters.map((entry) => ({ name: entry.profile.name, rig: buildRig(entry.profile), pose: entry.pose }));
}

function characterIndex(scene: SceneFile, value: unknown): number {
  const text = String(value);
  if (/^\d+$/.test(text) && Number(text) < scene.characters.length) return Number(text);
  const index = scene.characters.findIndex((entry) => entry.profile.name.toLowerCase() === text.toLowerCase());
  if (index === -1) throw new Error(`No character "${text}". In this scene: ${scene.characters.map((entry, number) => `${number} ${entry.profile.name}`).join(', ')}`);
  return index;
}

function clampSize(value: unknown, fallback: number): number {
  const number = Number(value ?? fallback);
  return Math.min(4096, Math.max(16, Number.isFinite(number) ? Math.round(number) : fallback));
}
// #endregion
