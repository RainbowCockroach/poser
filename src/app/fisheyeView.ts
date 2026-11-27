/*
 * The fisheye camera on the stage. three.js cameras only make straight-line pictures, so the stage is drawn by a
 * very wide normal camera and a screen shader bends that picture into a fisheye (core/camera.ts fisheyeRay).
 * Clicks and drags must hit what is drawn under the pointer, so every place that turns the pointer into a ray asks
 * toSourcePointer() first, and a 3D point drawn on screen goes through toScreenPoint().
 * The stage keeps fisheyeView up to date on every render; with the fisheye off both mappings change nothing.
 * The wide picture is drawn without its background and with colors not yet finished, so the shader finishes them
 * the way three.js does for the plain stage (ACES tone mapping, then sRGB) and lays them over the untouched
 * background color: shadows and grid lines then look exactly as without the fisheye.
 */

// #region Setup
import { Color, Vector2 } from 'three';
import { FISHEYE_HALF_DIAGONAL_DEGREES, fisheyePoint, fisheyeRay } from '../core/camera';
// #endregion

// #region Config
// Shared with the drag code and click picking; written only by the stage (updateFisheyeView).
export const fisheyeView = {
  isOn: false,
  aspect: 1,
  // Where the middle of the view is, in screen units from -1 to 1 (it moves left when the card covers the right).
  centerX: 0,
  halfDiagonal: Math.SQRT2,
  // The wide camera's half height on the image plane one unit ahead.
  sourceHalfTangent: 1,
};

export const FISHEYE_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    aspect: { value: 1 },
    centerX: { value: 0 },
    halfDiagonal: { value: Math.SQRT2 },
    sourceHalfTangent: { value: 1 },
    maxAngle: { value: (FISHEYE_HALF_DIAGONAL_DEGREES * Math.PI) / 180 },
    // The scene background as a screen color, and whether a saved image keeps it see-through instead.
    background: { value: new Color() },
    isTransparent: { value: false },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  // The same formula as toSourcePointer(), per pixel.
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float aspect;
    uniform float centerX;
    uniform float halfDiagonal;
    uniform float sourceHalfTangent;
    uniform float maxAngle;
    uniform vec3 background;
    uniform bool isTransparent;
    varying vec2 vUv;

    // three.js ACESFilmicToneMapping at exposure 1.
    vec3 filmic(vec3 color) {
      const mat3 inputMatrix = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
      const mat3 outputMatrix = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
      color = inputMatrix * (color / 0.6);
      color = (color * (color + 0.0245786) - 0.000090537) / (color * (0.983729 * color + 0.4329510) + 0.238081);
      return clamp(outputMatrix * color, 0.0, 1.0);
    }

    vec3 toScreen(vec3 linear) {
      return mix(pow(linear, vec3(1.0 / 2.4)) * 1.055 - 0.055, linear * 12.92, vec3(lessThanEqual(linear, vec3(0.0031308))));
    }

    void main() {
      vec2 screen = vUv * 2.0 - 1.0;
      vec2 point = vec2((screen.x - centerX) * aspect, screen.y);
      float radius = length(point);
      float planeRadius = tan(min(radius / halfDiagonal * maxAngle, 1.5697));
      vec2 plane = radius > 1e-6 ? point / radius * planeRadius : vec2(0.0);
      vec2 source = vec2(plane.x / (sourceHalfTangent * aspect) + centerX, plane.y / sourceHalfTangent);
      // The drawing holds colors already multiplied by how solid they are (a shadow is black at 18%).
      vec4 drawn = texture2D(tDiffuse, clamp(source * 0.5 + 0.5, 0.0, 1.0));
      vec3 color = drawn.a > 0.0 ? toScreen(filmic(drawn.rgb / drawn.a)) : vec3(0.0);
      gl_FragColor = isTransparent ? vec4(color * drawn.a, drawn.a) : vec4(mix(background, color, drawn.a), 1.0);
    }
  `,
};
// #endregion

// #region Main flow
export function updateFisheyeView(isOn: boolean, aspect: number, centerX: number) {
  fisheyeView.isOn = isOn;
  fisheyeView.aspect = aspect;
  fisheyeView.centerX = centerX;
  // The farthest corner from the middle of the view sees the full fisheye angle.
  fisheyeView.halfDiagonal = Math.hypot(aspect * (1 + Math.abs(centerX)), 1);
  fisheyeView.sourceHalfTangent = Math.tan((FISHEYE_HALF_DIAGONAL_DEGREES * Math.PI) / 180) / fisheyeView.halfDiagonal;
}

// The vertical angle of view the wide camera needs so its corners reach the fisheye's corners.
export function sourceFieldOfViewDegrees(): number {
  return (2 * Math.atan(fisheyeView.sourceHalfTangent) * 180) / Math.PI;
}

// A pointer on the drawn (bent) picture, to the same spot on the wide camera's picture, both from -1 to 1.
export function toSourcePointer(screen: Vector2): Vector2 {
  if (!fisheyeView.isOn) return screen;
  const { aspect, centerX, halfDiagonal, sourceHalfTangent } = fisheyeView;
  const [planeX, planeY] = fisheyeRay((screen.x - centerX) * aspect, screen.y, halfDiagonal);
  return new Vector2(planeX / (sourceHalfTangent * aspect) + centerX, planeY / sourceHalfTangent);
}

// A point the wide camera projects (Vector3.project), to where it is drawn on the bent picture.
export function toScreenPoint(source: Vector2): Vector2 {
  if (!fisheyeView.isOn) return source;
  const { aspect, centerX, halfDiagonal, sourceHalfTangent } = fisheyeView;
  const [x, y] = fisheyePoint((source.x - centerX) * sourceHalfTangent * aspect, source.y * sourceHalfTangent, halfDiagonal);
  return new Vector2(x / aspect + centerX, y);
}
// #endregion
