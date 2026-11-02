import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

const damp = THREE.MathUtils.damp;

/**
 * Clawd, Claude Code's mascot, as voxels.
 *
 * Proportions follow the official pixel art (8px units): a 13×8 body,
 * 1×2 eyes, 2×2 arms on rows 4–5, and four 1-unit legs at columns
 * 0, 2, 10, 12. Eyes are placed symmetrically (columns 3 and 9) for the
 * front-facing pose, as in the terminal logo.
 */
export const CLAWD_COLOR = '#d77757';
const EYE_COLOR = '#141414';

const U = 0.1; // one pixel
const LEG_H = 1 * U;
const BODY_W = 13 * U;
const BODY_H = 8 * U;
const BODY_D = 7 * U;

/** Height of the top of Clawd's body above its feet. */
export const CLAWD_HEIGHT = LEG_H + BODY_H;

const col = (c) => (c - 6) * U; // pixel column → x, body centered at column 6
const row = (r) => LEG_H + (BODY_H - (r + 0.5) * U); // pixel row (from top) → y

function Box({ size, position, color, emissive = 0, ...props }) {
  return (
    <mesh position={position} castShadow {...props}>
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} roughness={0.5} metalness={0.02} emissive={color} emissiveIntensity={emissive} />
    </mesh>
  );
}

function Crown() {
  const gold = '#f5c451';
  return (
    <group position={[0, CLAWD_HEIGHT + 0.06, 0]}>
      <mesh>
        <cylinderGeometry args={[0.2, 0.22, 0.08, 6]} />
        <meshStandardMaterial color={gold} emissive={gold} emissiveIntensity={0.9} metalness={0.6} roughness={0.3} />
      </mesh>
      {Array.from({ length: 5 }, (_, i) => {
        const a = (i / 5) * Math.PI * 2;
        return (
          <mesh key={i} position={[Math.sin(a) * 0.17, 0.09, Math.cos(a) * 0.17]}>
            <coneGeometry args={[0.04, 0.12, 4]} />
            <meshStandardMaterial color={gold} emissive={gold} emissiveIntensity={0.9} metalness={0.6} roughness={0.3} />
          </mesh>
        );
      })}
    </group>
  );
}

function Halo() {
  return (
    <mesh position={[0, CLAWD_HEIGHT + 0.22, 0]} rotation={[Math.PI / 2, 0, 0]}>
      <torusGeometry args={[0.22, 0.014, 8, 48]} />
      <meshStandardMaterial color="#ffd9a0" emissive="#ffd9a0" emissiveIntensity={2} />
    </mesh>
  );
}

/** status: 'idle' | 'thinking' | 'speaking' | 'absent' */
export default function ClawdFigure({ status, seed = 0, crown = false, halo = false }) {
  const body = useRef();
  const eyes = useRef();
  const leftArm = useRef();
  const rightArm = useRef();

  const absent = status === 'absent';
  const color = absent ? '#6b4a40' : CLAWD_COLOR;

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime + seed;
    const speaking = status === 'speaking';
    const thinking = status === 'thinking';

    // Speaking: little hops with squash and stretch. Idle: a slow bob.
    const hop = speaking ? Math.abs(Math.sin(t * 6.5)) : 0;
    // Never dip below the feet's resting height, or the legs sink into the seat.
    body.current.position.y = speaking ? hop * 0.09 : (1 + Math.sin(t * 1.6)) * 0.008;
    const squash = speaking ? 1 + (hop - 0.5) * 0.08 : 1;
    body.current.scale.set(2 - squash, squash, 1);
    body.current.rotation.z = damp(body.current.rotation.z, thinking ? Math.sin(t * 0.9) * 0.06 : 0, 3, delta);

    // Arms flap while talking, rest otherwise.
    const flap = speaking ? Math.sin(t * 9) * 0.55 : 0;
    leftArm.current.rotation.z = damp(leftArm.current.rotation.z, -flap - (speaking ? 0.2 : 0), 12, delta);
    rightArm.current.rotation.z = damp(rightArm.current.rotation.z, -flap + (speaking ? 0.2 : 0), 12, delta);

    // Eyes: look around while thinking, blink now and then, closed when absent.
    eyes.current.position.x = damp(eyes.current.position.x, thinking ? Math.sin(t * 1.4) * U * 1.2 : 0, 6, delta);
    const blink = (t % 4.3) < 0.12;
    eyes.current.scale.y = damp(eyes.current.scale.y, absent || blink ? 0.12 : 1, 30, delta);
  });

  return (
    <group ref={body}>
      {/* Body */}
      <Box size={[BODY_W, BODY_H, BODY_D]} position={[0, LEG_H + BODY_H / 2, 0]} color={color} emissive={0.28} />

      {/* Eyes, slightly proud of the front face */}
      <group ref={eyes} position={[0, row(2.5), BODY_D / 2 + 0.006]}>
        {[3, 9].map((c) => (
          <Box key={c} size={[U, 2 * U, 0.02]} position={[col(c), 0, 0]} color={EYE_COLOR} />
        ))}
      </group>

      {/* Arms pivot at the body's side so they can flap */}
      <group ref={leftArm} position={[-BODY_W / 2, row(4.5), 0]}>
        <Box size={[2 * U, 2 * U, 3 * U]} position={[-U, 0, 0]} color={color} emissive={0.28} />
      </group>
      <group ref={rightArm} position={[BODY_W / 2, row(4.5), 0]} scale={[-1, 1, 1]}>
        <Box size={[2 * U, 2 * U, 3 * U]} position={[-U, 0, 0]} color={color} emissive={0.28} />
      </group>

      {/* Legs, flush with the front face: the body is deep, so centered legs hide under it */}
      {[0, 2, 10, 12].map((c) => (
        <Box key={c} size={[U, LEG_H, 2 * U]} position={[col(c), LEG_H / 2, BODY_D / 2 - U]} color={color} emissive={0.55} />
      ))}

      {crown && <Crown />}
      {halo && <Halo />}
    </group>
  );
}
