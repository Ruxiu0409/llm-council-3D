import { Suspense, useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { ContactShadows, Sparkles } from '@react-three/drei';
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';
import * as THREE from 'three';
import Avatar from './Avatar';
import VoteArcs from './VoteArcs';
import { CHAIR } from './useCouncilScene';
import { CHAIR_POSITION, SEAT_FOCUS, TABLE_RADIUS, rowCount, seatPositions } from './layout';
import { shortName } from '../../names';

const STAGE_COLORS = ['#e8ecf4', '#6aa8ff', '#ffb35c', '#7ee0a1', '#7ee0a1'];

const BASE_CAMERA = new THREE.Vector3(0, 6.0, 11.4);
const BASE_TARGET = new THREE.Vector3(0, 1.2, -1.4);

/** Eases the camera toward whoever is speaking, with a little pointer parallax. */
function CameraRig({ focus, rows = 1 }) {
  // Pull back and up for extra rows of seats so the whole council stays in frame.
  const zoom = 1 + (rows - 1) * 0.3;
  const target = useRef(BASE_TARGET.clone());
  const scratch = useRef({ pos: new THREE.Vector3(), target: new THREE.Vector3() });

  useFrame((state, delta) => {
    const { camera, pointer } = state;
    const { pos: desiredPos, target: desiredTarget } = scratch.current;
    if (focus) {
      // A gentle lean toward the speaker; keep the whole council in frame.
      desiredTarget.set(focus[0] * 0.3, 1.4 + focus[1] * 0.5, focus[2] * 0.3 - 0.9);
      desiredPos.set(focus[0] * 0.18, 5.6 * zoom, 10.6 * zoom + focus[2] * 0.1);
    } else {
      desiredTarget.copy(BASE_TARGET);
      desiredPos.copy(BASE_CAMERA).multiplyScalar(zoom);
    }
    desiredPos.x += pointer.x * 0.6;
    desiredPos.y += pointer.y * 0.3;
    const k = 1 - Math.exp(-delta * 1.6);
    camera.position.lerp(desiredPos, k);
    target.current.lerp(desiredTarget, k);
    camera.lookAt(target.current);
  });
  return null;
}

function Table({ stage }) {
  const ring = useRef();
  const color = STAGE_COLORS[stage ?? 0];
  useFrame((state, delta) => {
    ring.current.material.color.lerp(new THREE.Color(color), 1 - Math.exp(-delta * 2));
    ring.current.material.emissive.copy(ring.current.material.color);
    ring.current.rotation.z += delta * 0.1;
  });
  return (
    <group>
      <mesh position={[0, 0.42, 0]} receiveShadow castShadow>
        <cylinderGeometry args={[TABLE_RADIUS, TABLE_RADIUS * 0.92, 0.14, 96]} />
        <meshStandardMaterial color="#121620" roughness={0.35} metalness={0.55} />
      </mesh>
      <mesh position={[0, 0.2, 0]}>
        <cylinderGeometry args={[0.5, 0.8, 0.4, 32]} />
        <meshStandardMaterial color="#0d1017" roughness={0.6} />
      </mesh>
      <mesh ref={ring} position={[0, 0.5, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <torusGeometry args={[TABLE_RADIUS - 0.08, 0.025, 12, 128]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={2} toneMapped={false} />
      </mesh>
      {/* Inlaid seal */}
      <mesh position={[0, 0.495, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.55, 0.6, 64]} />
        <meshBasicMaterial color={color} transparent opacity={0.35} toneMapped={false} />
      </mesh>
      <mesh position={[0, 0.495, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.25, 1.27, 96]} />
        <meshBasicMaterial color={color} transparent opacity={0.18} toneMapped={false} />
      </mesh>
    </group>
  );
}

function Room() {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[14, 96]} />
        <meshStandardMaterial color="#0a0d14" roughness={0.9} />
      </mesh>
      {[4.6, 6.2].map((r) => (
        <mesh key={r} position={[0, 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[r, r + 0.02, 128]} />
          <meshBasicMaterial color="#26304a" transparent opacity={0.6} />
        </mesh>
      ))}
      {/* Chairman's dais */}
      <mesh position={[CHAIR_POSITION[0], 0.22, CHAIR_POSITION[2]]} receiveShadow castShadow>
        <cylinderGeometry args={[1.15, 1.3, 0.45, 48]} />
        <meshStandardMaterial color="#121620" roughness={0.5} metalness={0.4} />
      </mesh>
      {/* Back wall pillars */}
      {Array.from({ length: 9 }, (_, i) => {
        const a = ((i - 4) / 4) * 1.25;
        return (
          <mesh key={i} position={[Math.sin(a) * 9, 2.5, -Math.cos(a) * 9]}>
            <boxGeometry args={[0.35, 5, 0.35]} />
            <meshStandardMaterial color="#0f131c" roughness={0.8} />
          </mesh>
        );
      })}
    </group>
  );
}

/**
 * The 3D council chamber.
 * `scene` comes from useCouncilScene; `onSelect(seatId)` opens that seat's transcript.
 */
export default function Chamber({ scene, onSelect }) {
  const { seats, chairmanId, current, seatStatus, chairStatus, votes, standings, stage } = scene;
  const positions = useMemo(() => seatPositions(seats.length), [seats.length]);
  const rows = rowCount(seats.length);

  const positionOf = (id) => {
    if (id === CHAIR) return CHAIR_POSITION;
    const i = seats.findIndex((s) => s.id === id);
    return i >= 0 ? positions[i] : null;
  };
  const modelOf = (id) => seats.find((s) => s.id === id)?.model || chairmanId;
  const focus = current ? positionOf(current.speaker) : null;

  return (
    <Canvas
      shadows="percentage"
      dpr={[1, 2]}
      camera={{ position: BASE_CAMERA.toArray(), fov: 46 }}
      gl={{ antialias: true }}
    >
      <color attach="background" args={['#06080d']} />
      <fog attach="fog" args={['#06080d', 11 + (rows - 1) * 4, 22 + (rows - 1) * 6]} />
      <ambientLight intensity={0.55} />
      <hemisphereLight args={['#9fb4e8', '#141a26', 1.1]} />
      <directionalLight position={[0, 6, 12]} intensity={1.3} color="#dfe6ff" />
      <directionalLight position={[-6, 4, -8]} intensity={1.6} color="#7f9cff" />
      <spotLight
        position={[0, 11, 2]}
        angle={0.55}
        penumbra={0.8}
        intensity={140}
        castShadow
        shadow-mapSize={[1024, 1024]}
        color="#dfe6ff"
      />
      <CameraRig focus={focus} rows={rows} />

      <Suspense fallback={null}>
        <Room />
        <Table stage={stage} />

        {chairmanId && (
          <Avatar
            isChair
            modelId={chairmanId}
            title="主席"
            subtitle={shortName(chairmanId)}
            position={CHAIR_POSITION}
            lookAt={[0, 0, 0]}
            status={chairStatus}
            speech={current?.speaker === CHAIR ? current : null}
            onSelect={() => onSelect(CHAIR)}
          />
        )}

        {seats.map((seat, i) => (
          <Avatar
            key={seat.id}
            modelId={seat.model}
            title={seat.role || shortName(seat.model)}
            subtitle={shortName(seat.model)}
            position={positions[i]}
            lookAt={SEAT_FOCUS}
            status={seatStatus(seat.id)}
            speech={current?.speaker === seat.id ? current : null}
            standing={standings[seat.id]}
            onSelect={() => onSelect(seat.id)}
          />
        ))}

        <VoteArcs votes={votes} positionOf={positionOf} modelOf={modelOf} />

        <Sparkles count={70} scale={[16, 6, 16]} position={[0, 3, -1]} size={1.6} speed={0.25} opacity={0.35} color="#9fb4e8" />
        <ContactShadows position={[0, 0.01, 0]} opacity={0.55} scale={18} blur={2.4} far={4} />
      </Suspense>

      <EffectComposer>
        <Bloom mipmapBlur intensity={0.85} luminanceThreshold={0.55} luminanceSmoothing={0.2} />
        <Vignette offset={0.25} darkness={0.75} />
      </EffectComposer>
    </Canvas>
  );
}
