import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

const damp = THREE.MathUtils.damp;

/**
 * Codex, after the official Codex app icon: a puffy blue-violet cloud with a
 * terminal prompt `>_` for a face. The `>` is the eye; the `_` cursor is the
 * mouth, so it blinks when idle and types when speaking.
 */
const RADIUS = 0.52;
const LOBES = 8;
const DEPTH = 0.22;
const BEVEL = 0.1;

export const CODEX_CENTER = 0.66; // cloud center above the seat
export const CODEX_HEIGHT = CODEX_CENTER + RADIUS + BEVEL;

const GRADIENT = [
  [1.0, new THREE.Color('#c9b5f8')], // lavender top
  [0.55, new THREE.Color('#7b93ff')],
  [0.0, new THREE.Color('#2f2ee8')], // deep blue bottom
];

function gradientAt(t) {
  for (let i = 0; i < GRADIENT.length - 1; i++) {
    const [t0, c0] = GRADIENT[i];
    const [t1, c1] = GRADIENT[i + 1];
    if (t <= t0 && t >= t1) return c1.clone().lerp(c0, (t - t1) / (t0 - t1));
  }
  return t > 1 ? GRADIENT[0][1].clone() : GRADIENT[GRADIENT.length - 1][1].clone();
}

function cloudGeometry() {
  // Scalloped outline: round bumps with sharp dents between them.
  const shape = new THREE.Shape();
  const steps = 160;
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const r = RADIUS * (0.86 + 0.14 * Math.abs(Math.sin((LOBES / 2) * a)));
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: DEPTH,
    bevelEnabled: true,
    bevelThickness: BEVEL,
    bevelSize: BEVEL,
    bevelSegments: 5,
  });
  geometry.translate(0, 0, -DEPTH / 2);

  const pos = geometry.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const span = RADIUS + BEVEL;
  for (let i = 0; i < pos.count; i++) {
    // Diagonal gradient like the icon: lighter toward the top.
    const t = (pos.getY(i) + pos.getX(i) * 0.25 + span) / (2 * span);
    const c = gradientAt(Math.min(1, Math.max(0, t)));
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

const FACE_Z = DEPTH / 2 + BEVEL + 0.012;
const FACE_COLOR = '#eef0ff';

function Stroke({ length, rotation = 0, position }) {
  return (
    <mesh position={position} rotation={[0, 0, rotation]}>
      <capsuleGeometry args={[0.034, length, 6, 12]} />
      <meshStandardMaterial color={FACE_COLOR} emissive={FACE_COLOR} emissiveIntensity={0.9} />
    </mesh>
  );
}

/** status: 'idle' | 'thinking' | 'speaking' | 'absent' */
export default function CodexFigure({ status, seed = 0 }) {
  const geometry = useMemo(() => cloudGeometry(), []);
  const cloud = useRef();
  const prompt = useRef();
  const cursor = useRef();
  const material = useRef();
  const absent = status === 'absent';

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime + seed;
    const speaking = status === 'speaking';
    const thinking = status === 'thinking';

    // Clouds float. Speaking adds a lively bounce and a little pulse.
    const bounce = speaking ? Math.abs(Math.sin(t * 6)) * 0.07 : 0;
    cloud.current.position.y = CODEX_CENTER + Math.sin(t * 1.4) * 0.035 + bounce;
    const pulse = speaking ? 1 + Math.sin(t * 12) * 0.025 : 1;
    cloud.current.scale.setScalar(pulse);
    cloud.current.rotation.y = damp(cloud.current.rotation.y, thinking ? Math.sin(t * 0.9) * 0.35 : 0, 3, delta);
    cloud.current.rotation.z = Math.sin(t * 0.8) * 0.04;

    // The cursor types while speaking, blinks otherwise, and is off when absent.
    if (speaking) {
      cursor.current.visible = true;
      cursor.current.scale.x = damp(cursor.current.scale.x, 0.5 + Math.abs(Math.sin(t * 11) * Math.sin(t * 3.7)) * 1.1, 20, delta);
    } else {
      cursor.current.scale.x = damp(cursor.current.scale.x, 1, 8, delta);
      const period = thinking ? 0.35 : 1.06;
      cursor.current.visible = !absent && (t % period) < period / 2;
    }
    prompt.current.rotation.z = speaking ? Math.sin(t * 8) * 0.08 : damp(prompt.current.rotation.z, 0, 6, delta);

    material.current.color.lerp(new THREE.Color(absent ? '#55586a' : '#ffffff'), 1 - Math.exp(-delta * 4));
  });

  return (
    <group ref={cloud} position={[0, CODEX_CENTER, 0]}>
      <mesh geometry={geometry} castShadow>
        <meshStandardMaterial ref={material} vertexColors roughness={0.25} metalness={0.1} emissive="#3b3ff0" emissiveIntensity={0.18} />
      </mesh>

      {/* > */}
      <group ref={prompt} position={[-0.14, 0.02, FACE_Z]}>
        <Stroke length={0.1} rotation={Math.PI / 4} position={[0, 0.05, 0]} />
        <Stroke length={0.1} rotation={-Math.PI / 4} position={[0, -0.05, 0]} />
      </group>

      {/* _ */}
      <group ref={cursor} position={[0.11, -0.1, FACE_Z]}>
        <Stroke length={0.13} rotation={Math.PI / 2} position={[0, 0, 0]} />
      </group>
    </group>
  );
}
