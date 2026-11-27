/*
 * Props on the stage: each prop is drawn from the same boxes the core uses (core/props.ts), casts and
 * takes shadows, and can be picked and dragged over the floor with a mouse or one finger.
 * A press that doesn't move is a tap: it only selects the prop.
 */

// #region Setup
import { useThree } from '@react-three/fiber';
import { Plane, Raycaster, Vector2, Vector3 } from 'three';
import type { ThreeEvent } from '@react-three/fiber';
import { propBoxes, type SceneProp } from '../core/props';
import type { Vec3 } from '../core/rig';
import { toSourcePointer } from './fisheyeView';
// #endregion

// #region Types and config
export interface PropEntry extends SceneProp {
  id: string;
  // Locked props ignore the pointer, so they can't be picked or dragged by accident.
  isLocked?: boolean;
  isHidden?: boolean;
}

interface PropMeshesProps {
  props: PropEntry[];
  selectedPropId: string | null;
  isExporting: boolean;
  onSelect: (id: string) => void;
  onMove: (id: string, position: Vec3, gestureKey: string) => void;
}

const DRAG_START_PIXELS = 5;
const SELECTED_GLOW = '#3d4fd6';
// #endregion

// #region Main flow
export function PropMeshes({ props, selectedPropId, isExporting, onSelect, onMove }: PropMeshesProps) {
  const camera = useThree((state) => state.camera);
  const canvas = useThree((state) => state.gl.domElement);
  const controls = useThree((state) => state.controls) as { enabled: boolean } | null;

  const startDrag = (prop: PropEntry, event: ThreeEvent<PointerEvent>) => {
    if (prop.isLocked) return;
    event.stopPropagation();
    // Right and middle buttons, and Alt with the left one, stay with the camera.
    if (event.nativeEvent.button !== 0 || event.nativeEvent.altKey) return;
    onSelect(prop.id);
    // The grabbed point slides over a level plane at its own height, so it stays under the finger.
    const plane = new Plane(new Vector3(0, 1, 0), -event.point.y);
    const grabbed = event.point.clone();
    const startPosition = new Vector3(...prop.position);
    const raycaster = new Raycaster();
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    const gestureKey = `drag:prop:${performance.now()}`;
    let isDragging = false;

    const handleMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      if (!isDragging && Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < DRAG_START_PIXELS) return;
      isDragging = true;
      const bounds = canvas.getBoundingClientRect();
      const normalized = new Vector2(((moveEvent.clientX - bounds.left) / bounds.width) * 2 - 1, -((moveEvent.clientY - bounds.top) / bounds.height) * 2 + 1);
      raycaster.setFromCamera(toSourcePointer(normalized), camera);
      const hit = raycaster.ray.intersectPlane(plane, new Vector3());
      if (!hit) return;
      const position = startPosition.clone().add(hit.sub(grabbed).setY(0));
      onMove(prop.id, position.toArray().map((value) => Math.round(value * 1000) / 1000) as Vec3, gestureKey);
    };
    const handleEnd = (endEvent: PointerEvent) => {
      if (endEvent.pointerId !== pointerId) return;
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleEnd);
      window.removeEventListener('pointercancel', handleEnd);
      if (controls) controls.enabled = true;
    };

    // OrbitControls also saw this press; switched off, it ignores the moves until the finger lifts.
    if (controls) controls.enabled = false;
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleEnd);
    window.addEventListener('pointercancel', handleEnd);
  };

  return (
    <>
      {props.filter((prop) => !prop.isHidden).map((prop) => {
        const isSelected = prop.id === selectedPropId && !isExporting;
        return (
          <group key={prop.id} onPointerDown={(event) => startDrag(prop, event)}>
            {propBoxes(prop).map((box, index) => (
              <mesh key={index} position={box.center} rotation={[0, (box.turnDegrees * Math.PI) / 180, 0]} castShadow receiveShadow>
                <boxGeometry args={[box.halfSize[0] * 2, box.halfSize[1] * 2, box.halfSize[2] * 2]} />
                <meshStandardMaterial color={prop.color} roughness={0.85} emissive={isSelected ? SELECTED_GLOW : '#000000'} emissiveIntensity={isSelected ? 0.12 : 0} />
              </mesh>
            ))}
          </group>
        );
      })}
    </>
  );
}
// #endregion
