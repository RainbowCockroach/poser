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
import { encodePng, renderScene, VIEWS, type View } from './render.ts';
// #endregion

// #region Types and config
interface SceneFile {
  format: 'poser.scene/1';
  characters: { profile: CharacterProfile; pose: Pose }[];
  lights?: SceneLight[];
  background?: string;
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

const VERSION = '0.5.0';
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
  view: `camera: ${Object.keys(VIEWS).join(', ')} (default three-quarter)`,
  width: 'image width in pixels (default 1200)',
  height: 'image height in pixels (default 900)',
  transparent: 'true for a transparent background',
  site: 'the Poser site the link opens (default: the GitHub Pages site)',
};
// #endregion

// #region Main flow
const COMMANDS: Record<string, Command> = {
  render: {
    summary: 'Render the scene to a PNG.',
    positional: ['scene'],
    options: { view: 'string', width: 'number', height: 'number', out: 'string', transparent: 'boolean' },
    run: (args) => {
      const scene = readScene(args);
      const view = (args.view as View | undefined) ?? 'three-quarter';
      if (!VIEWS[view]) throw new Error(`Unknown view "${view}". Known: ${Object.keys(VIEWS).join(', ')}`);
      const width = clampSize(args.width, 1200);
      const height = clampSize(args.height, 900);
      const started = performance.now();
      const image = renderScene(
        {
          characters: scene.characters.map((entry) => ({ rig: buildRig(entry.profile), pose: entry.pose })),
          lights: scene.lights ?? DEFAULT_LIGHTS,
          background: scene.background ?? DEFAULT_BACKGROUND,
        },
        { width, height, view, isTransparent: args.transparent === true || args.transparent === 'true' },
      );
      const png = encodePng(image.width, image.height, image.rgba);
      const out = typeof args.out === 'string' ? args.out : String(args.scene).replace(/(\.scene)?\.json$/, '') + `.${view}.png`;
      writeFileSync(out, png);
      return { text: `Wrote ${out} (${width}×${height}, ${view} view, ${Math.round(performance.now() - started)} ms)`, png };
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
    summary: 'Lift or lower characters so their lowest point stands on the floor. Edits the scene file.',
    positional: ['scene'],
    options: { character: 'string', out: 'string' },
    run: (args) => {
      const scene = readScene(args);
      const indexes = args.character === undefined ? scene.characters.map((_, index) => index) : [characterIndex(scene, args.character)];
      for (const index of indexes) scene.characters[index].pose = dropToFloor(buildRig(scene.characters[index].profile), scene.characters[index].pose);
      return { text: `Dropped ${indexes.length} character(s) to the floor. Wrote ${writeScene(scene, args)}` };
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
      character.pose = dropToFloor(buildRig(character.profile), { ...character.pose, joints });
      return { text: `${character.profile.name}: ${file.name}. Wrote ${writeScene(scene, args)}` };
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
