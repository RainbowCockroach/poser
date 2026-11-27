/*
 * Draws the scene lights, plus a small marker for each one (hidden in PNG exports). Clicking a marker selects the
 * light; dragging it slides the light at its height and it keeps shining at the same spot. Locked lights ignore it.
 * Light data and presets live in core/lights.ts. Intensity there is "brightness at the target", so
 * point and spot lights are drawn at intensity × distance² with real falloff (decay 2).
 */

// #region Setup
import { useMemo } from 'react';
import { Line } from '@react-three/drei';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import { Object3D, Plane, Raycaster, Vector2, Vector3 } from 'three';
import { SHADOW_TYPE, type LightEntry } from './App';
import type { Vec3 } from '../core/rig';
import { toSourcePointer } from './fisheyeView';
// #endregion

// #region Config
const MARKER_RADIUS = 0.05;
// The marker is small; a press this far around it still grabs it.
const MARKER_GRAB_RADIUS = 0.12;
const DRAG_START_PIXELS = 5;
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
  onSelect: (id: string) => void;
  onMove: (id: string, position: Vec3, gestureKey: string) => void;
}

export function SceneLights({ lights, selectedLightId, isShowingMarkers, onSelect, onMove }: SceneLightsProps) {
  const camera = useThree((state) => state.camera);
  const canvas = useThree((state) => state.gl.domElement);
  const controls = useThree((state) => state.controls) as { enabled: boolean } | null;

  const startDrag = (light: LightEntry, event: ThreeEvent<PointerEvent>) => {
    if (light.isLocked || event.nativeEvent.button !== 0 || event.nativeEvent.altKey) return;
    event.stopPropagation();
    onSelect(light.id);
    const start = new Vector3(...light.position);
    const plane = new Plane(new Vector3(0, 1, 0), -start.y);
    const raycaster = new Raycaster();
    const pointerAt = (clientX: number, clientY: number) => {
      const bounds = canvas.getBoundingClientRect();
      raycaster.setFromCamera(toSourcePointer(new Vector2(((clientX - bounds.left) / bounds.width) * 2 - 1, -((clientY - bounds.top) / bounds.height) * 2 + 1)), camera);
      return raycaster.ray.intersectPlane(plane, new Vector3());
    };
    const grabbed = pointerAt(event.nativeEvent.clientX, event.nativeEvent.clientY) ?? start.clone();
    const { pointerId, clientX: startX, clientY: startY } = event.nativeEvent;
    const gestureKey = `drag:light:${performance.now()}`;
    let isDragging = false;

    const handleMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      if (!isDragging && Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < DRAG_START_PIXELS) return;
      isDragging = true;
      const hit = pointerAt(moveEvent.clientX, moveEvent.clientY);
      if (!hit) return;
      const position = start.clone().add(hit.sub(grabbed).setY(0));
      onMove(light.id, position.toArray().map((value) => Math.round(value * 1000) / 1000) as Vec3, gestureKey);
    };
    const handleEnd = (endEvent: PointerEvent) => {
      if (endEvent.pointerId !== pointerId) return;
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleEnd);
      window.removeEventListener('pointercancel', handleEnd);
      if (controls) controls.enabled = true;
    };
    if (controls) controls.enabled = false;
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleEnd);
    window.addEventListener('pointercancel', handleEnd);
  };

  return (
    <>
      {lights.filter((light) => !light.isHidden).map((light) => (
        <group key={`${light.id}-${light.kind}`}>
          <Light light={light} />
          {isShowingMarkers && light.kind !== 'ambient' && <LightMarker light={light} isSelected={light.id === selectedLightId} onPointerDown={(event) => startDrag(light, event)} />}
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

// Only an invisible ball around the marker catches the pointer; the aim line never does, so it can't block posing.
function LightMarker({ light, isSelected, onPointerDown }: { light: LightEntry; isSelected: boolean; onPointerDown: (event: ThreeEvent<PointerEvent>) => void }) {
  const isAimed = light.kind === 'spot' || light.kind === 'sun';
  return (
    <>
      {!light.isLocked && (
        <mesh position={light.position} visible={false} onPointerDown={onPointerDown}>
          <sphereGeometry args={[MARKER_GRAB_RADIUS, 8, 6]} />
        </mesh>
      )}
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
