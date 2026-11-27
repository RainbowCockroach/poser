/*
 * Draws the scene lights, plus a small marker for each one (hidden in PNG exports).
 * Light data and presets live in core/lights.ts. Intensity there is "brightness at the target", so
 * point and spot lights are drawn at intensity × distance² with real falloff (decay 2).
 */

// #region Setup
import { useMemo } from 'react';
import { Line } from '@react-three/drei';
import { Object3D, Vector3 } from 'three';
import { SHADOW_TYPE, type LightEntry } from './App';
// #endregion

// #region Config
const MARKER_RADIUS = 0.05;
const SUN_SHADOW_HALF_SIZE = 5;
// Small offsets that stop the mannequin from shadowing its own surface in stripes.
const SHADOW_BIAS = -0.0004;
const SHADOW_NORMAL_BIAS = 0.02;
// #endregion

// #region Main flow
interface SceneLightsProps {
  lights: LightEntry[];
  selectedLightId: string | null;
  isShowingMarkers: boolean;
}

export function SceneLights({ lights, selectedLightId, isShowingMarkers }: SceneLightsProps) {
  return (
    <>
      {lights.map((light) => (
        <group key={`${light.id}-${light.kind}`}>
          <Light light={light} />
          {isShowingMarkers && light.kind !== 'ambient' && <LightMarker light={light} isSelected={light.id === selectedLightId} />}
        </group>
      ))}
    </>
  );
}

function Light({ light }: { light: LightEntry }) {
  const target = useMemo(() => new Object3D(), []);
  target.position.set(...light.target);
  const distance = new Vector3(...light.position).distanceTo(new Vector3(...light.target));

  if (light.kind === 'ambient') return <hemisphereLight args={[light.color, light.groundColor ?? light.color, light.intensity]} />;

  if (light.kind === 'sun') {
    return (
      <>
        <primitive object={target} />
        <directionalLight
          position={light.position}
          target={target}
          color={light.color}
          intensity={light.intensity}
          castShadow={light.castShadow}
          shadow-mapSize={[2048, 2048]}
          shadow-bias={SHADOW_BIAS}
          shadow-normalBias={SHADOW_NORMAL_BIAS}
          shadow-camera-left={-SUN_SHADOW_HALF_SIZE}
          shadow-camera-right={SUN_SHADOW_HALF_SIZE}
          shadow-camera-top={SUN_SHADOW_HALF_SIZE}
          shadow-camera-bottom={-SUN_SHADOW_HALF_SIZE}
          shadow-camera-near={0.1}
          shadow-camera-far={distance + 20}
        />
      </>
    );
  }

  if (light.kind === 'spot') {
    return (
      <>
        <primitive object={target} />
        <spotLight
          position={light.position}
          target={target}
          color={light.color}
          intensity={light.intensity * distance * distance}
          decay={2}
          angle={((light.coneDegrees ?? 35) * Math.PI) / 180}
          penumbra={light.softness ?? 0.4}
          castShadow={light.castShadow}
          shadow-mapSize={[2048, 2048]}
          shadow-bias={SHADOW_BIAS}
          shadow-normalBias={SHADOW_NORMAL_BIAS}
        />
      </>
    );
  }

  return (
    <pointLight
      position={light.position}
      color={light.color}
      intensity={light.intensity * distance * distance}
      decay={2}
      castShadow={light.castShadow && SHADOW_TYPE !== 'variance'}
      shadow-mapSize={[1024, 1024]}
      shadow-bias={SHADOW_BIAS}
      shadow-normalBias={SHADOW_NORMAL_BIAS}
    />
  );
}

// Markers never catch the pointer, so a light in front of a character doesn't block posing it.
function LightMarker({ light, isSelected }: { light: LightEntry; isSelected: boolean }) {
  const isAimed = light.kind === 'spot' || light.kind === 'sun';
  return (
    <>
      <mesh position={light.position} scale={isSelected ? 1.8 : 1} raycast={() => null}>
        <sphereGeometry args={[MARKER_RADIUS, 16, 12]} />
        <meshBasicMaterial color={light.color} />
      </mesh>
      <mesh position={light.position} scale={isSelected ? 1.8 : 1} raycast={() => null}>
        <sphereGeometry args={[MARKER_RADIUS * 1.25, 16, 12]} />
        <meshBasicMaterial color={isSelected ? '#ff8a3d' : '#1d2030'} wireframe />
      </mesh>
      {isAimed && <Line points={[light.position, light.target]} color={isSelected ? '#ff8a3d' : '#6b7085'} lineWidth={1} dashed dashSize={0.06} gapSize={0.04} raycast={() => null} />}
    </>
  );
}
// #endregion
