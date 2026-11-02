import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { modelStyle } from './providers';
import SpeechBubble from './SpeechBubble';
import ClawdFigure, { CLAWD_HEIGHT } from './Clawd';
import CodexFigure, { CODEX_HEIGHT } from './CodexFigure';
import OpenAILogo from './OpenAILogo';

const damp = THREE.MathUtils.damp;

const ROBE_PROFILE = [
  [0.0, 0.0], [0.46, 0.0], [0.44, 0.18], [0.38, 0.5], [0.3, 0.78], [0.24, 0.95], [0.12, 1.04], [0.0, 1.06],
].map(([x, y]) => new THREE.Vector2(x, y));

function Spark({ color }) {
  // Claude: a radial starburst
  const rays = 10;
  return (
    <group>
      {Array.from({ length: rays }, (_, i) => (
        <mesh key={i} rotation={[0, 0, (i / rays) * Math.PI]}>
          <capsuleGeometry args={[0.022, i % 2 ? 0.2 : 0.3, 4, 8]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={2.2} />
        </mesh>
      ))}
    </group>
  );
}

function Star({ color }) {
  // Gemini: a four-pointed star
  const geometry = useMemo(() => {
    const shape = new THREE.Shape();
    const outer = 0.24;
    const inner = 0.05;
    for (let i = 0; i < 8; i++) {
      const r = i % 2 === 0 ? outer : inner;
      const a = (i / 8) * Math.PI * 2 + Math.PI / 2;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      if (i === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    }
    shape.closePath();
    return new THREE.ExtrudeGeometry(shape, { depth: 0.04, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 2 });
  }, []);
  return (
    <mesh geometry={geometry} position={[0, 0, -0.02]}>
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={2.2} />
    </mesh>
  );
}

function Orb({ color }) {
  return (
    <mesh>
      <icosahedronGeometry args={[0.12, 1]} />
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={2} flatShading />
    </mesh>
  );
}

const EMBLEMS = { spark: Spark, star: Star, orb: Orb, openai: OpenAILogo };

/** The generic seated robot used for providers without an official mascot. */
function RobotFigure({ style, status, seed }) {
  const body = useRef();
  const head = useRef();
  const mouth = useRef();
  const dim = status === 'absent';

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime + seed;
    const speaking = status === 'speaking';
    const isThinking = status === 'thinking';

    // Breathing, plus an animated lean and nod while speaking
    body.current.position.y = Math.sin(t * 1.6) * 0.012 + (speaking ? Math.sin(t * 7) * 0.012 : 0);
    body.current.rotation.x = damp(body.current.rotation.x, speaking ? 0.1 : dim ? -0.08 : 0, 4, delta);
    head.current.rotation.x = speaking ? Math.sin(t * 5.5) * 0.08 : damp(head.current.rotation.x, isThinking ? -0.15 : 0, 3, delta);
    head.current.rotation.y = speaking ? Math.sin(t * 2.1) * 0.12 : isThinking ? Math.sin(t * 0.8) * 0.25 : damp(head.current.rotation.y, 0, 2, delta);

    // Mouth flaps with syllable-like rhythm
    const talk = speaking ? 0.25 + Math.abs(Math.sin(t * 13) * Math.sin(t * 4.3)) * 1.3 : 0.2;
    mouth.current.scale.y = damp(mouth.current.scale.y, talk, 18, delta);
  });

  return (
    <group ref={body}>
      {/* Robe */}
      <mesh castShadow>
        <latheGeometry args={[ROBE_PROFILE, 40]} />
        <meshStandardMaterial color={dim ? '#15171c' : style.body} roughness={0.55} metalness={0.15} />
      </mesh>
      {/* Collar trim */}
      <mesh position={[0, 0.97, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.19, 0.025, 12, 40]} />
        <meshStandardMaterial color={style.accent} emissive={style.accent} emissiveIntensity={dim ? 0.1 : 1.2} />
      </mesh>
      {/* Chest emblem stripe */}
      <mesh position={[0, 0.62, 0.31]} rotation={[-0.32, 0, 0]}>
        <boxGeometry args={[0.05, 0.36, 0.01]} />
        <meshStandardMaterial color={style.accent} emissive={style.accent} emissiveIntensity={dim ? 0.1 : 1.1} />
      </mesh>

      {/* Head */}
      <group ref={head} position={[0, 1.33, 0]}>
        <mesh castShadow>
          <sphereGeometry args={[0.3, 40, 32]} />
          <meshStandardMaterial color={dim ? '#555a63' : style.head} roughness={0.35} metalness={0.05} />
        </mesh>
        {/* Visor */}
        <mesh position={[0, 0.0, 0.17]} scale={[1, 0.62, 0.55]}>
          <sphereGeometry args={[0.25, 32, 24]} />
          <meshStandardMaterial color="#07090e" roughness={0.15} metalness={0.6} />
        </mesh>
        {/* Eyes */}
        {[-0.085, 0.085].map((x) => (
          <mesh key={x} position={[x, 0.035, 0.305]} scale={[1, status === 'thinking' ? 0.45 : 1, 1]}>
            <sphereGeometry args={[0.032, 16, 12]} />
            <meshStandardMaterial color={style.glow} emissive={style.glow} emissiveIntensity={dim ? 0.2 : 3} />
          </mesh>
        ))}
        {/* Mouth */}
        <mesh ref={mouth} position={[0, -0.065, 0.3]} scale={[1, 0.2, 1]}>
          <boxGeometry args={[0.1, 0.05, 0.01]} />
          <meshStandardMaterial color={style.glow} emissive={style.glow} emissiveIntensity={dim ? 0.2 : 2.6} />
        </mesh>
        {style.halo && (
          <mesh position={[0, 0.38, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.2, 0.012, 8, 48]} />
            <meshStandardMaterial color="#ffd9a0" emissive="#ffd9a0" emissiveIntensity={2} />
          </mesh>
        )}
      </group>
    </group>
  );
}

// Clawd stands on a low stool so its short legs stay visible from the camera.
const seatTop = (style) => (style.figure === 'clawd' ? 0.26 : 0.5);

/** Where the emblem floats, per figure (in the avatar's unscaled space). */
function emblemHeight(style) {
  if (style.figure === 'clawd') {
    const extra = style.crown ? 0.42 : style.halo ? 0.45 : 0.3;
    return seatTop(style) + CLAWD_HEIGHT + extra;
  }
  if (style.figure === 'codex') return seatTop(style) + CODEX_HEIGHT + 0.32;
  return 2.02;
}

/**
 * A council member seated at `position`, facing `lookAt`.
 * status: 'idle' | 'thinking' | 'speaking' | 'absent'
 */
export default function Avatar({
  modelId,
  title,
  subtitle,
  position,
  lookAt = [0, 0, 0],
  status = 'idle',
  speech,
  standing,
  isChair = false,
  onSelect,
}) {
  const style = modelStyle(modelId);
  const Emblem = EMBLEMS[style.emblem];
  const emblemY = emblemHeight(style);

  const root = useRef();
  const emblem = useRef();
  const thinking = useRef();
  const glow = useRef();
  const light = useRef();
  const appear = useRef(0);

  const rotationY = useMemo(() => {
    const dx = lookAt[0] - position[0];
    const dz = lookAt[2] - position[2];
    return Math.atan2(dx, dz);
  }, [position, lookAt]);

  const seed = useMemo(() => [...(title || '')].reduce((a, c) => a + c.charCodeAt(0), 0) % 100, [title]);

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime + seed;
    const speaking = status === 'speaking';
    const isThinking = status === 'thinking';
    const absent = status === 'absent';

    appear.current = damp(appear.current, 1, 3, delta);
    root.current.scale.setScalar(appear.current * style.scale);

    emblem.current.rotation.y += delta * (isThinking ? 3.2 : speaking ? 1.4 : 0.45);
    emblem.current.position.y = emblemY + Math.sin(t * 1.3) * 0.04;

    thinking.current.visible = isThinking;
    if (isThinking) thinking.current.rotation.y = t * 2.4;

    const glowTarget = speaking ? 1 : isThinking ? 0.45 : absent ? 0 : 0.18;
    glow.current.material.opacity = damp(glow.current.material.opacity, glowTarget, 4, delta);
    light.current.intensity = damp(light.current.intensity, speaking ? 9 : 0, 4, delta);
  });

  const dim = status === 'absent';

  const elevation = position[1];

  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      {/* Raised back-row bench */}
      {elevation > 0.01 && (
        <mesh position={[0, -elevation / 2, -0.12]} receiveShadow castShadow>
          <cylinderGeometry args={[0.85, 0.9, elevation, 32]} />
          <meshStandardMaterial color="#141924" roughness={0.6} metalness={0.3} />
        </mesh>
      )}
      <group ref={root} scale={0.001}>
        {/* Seat */}
        <mesh position={[0, seatTop(style) / 2, -0.12]} castShadow receiveShadow>
          <cylinderGeometry args={style.figure === 'clawd' ? [0.72, 0.76, seatTop(style), 32] : [0.5, 0.55, 0.5, 32]} />
          <meshStandardMaterial color="#232a38" roughness={0.6} metalness={0.3} />
        </mesh>
        <mesh position={[0, isChair ? 1.25 : 0.95, -0.52]} castShadow>
          <boxGeometry args={[isChair ? 1.1 : 0.9, isChair ? 2.0 : 1.4, 0.12]} />
          <meshStandardMaterial color="#1f2533" roughness={0.5} metalness={0.4} />
        </mesh>
        <mesh position={[0, isChair ? 2.27 : 1.66, -0.45]}>
          <boxGeometry args={[isChair ? 1.12 : 0.92, 0.035, 0.04]} />
          <meshStandardMaterial color={style.accent} emissive={style.accent} emissiveIntensity={1.4} />
        </mesh>

        <group position={[0, seatTop(style), 0]}>
          {style.figure === 'clawd' ? (
            <ClawdFigure status={status} seed={seed} crown={style.crown} halo={style.halo} />
          ) : style.figure === 'codex' ? (
            <CodexFigure status={status} seed={seed} />
          ) : (
            <RobotFigure style={style} status={status} seed={seed} />
          )}
        </group>

        {/* Floating provider emblem */}
        <group ref={emblem} position={[0, emblemY, 0]}>
          <Emblem color={dim ? '#3a3f48' : style.emblemColor || style.accent} />
        </group>

        {/* Thinking: orbiting dots */}
        <group ref={thinking} position={[0, emblemY, 0]} visible={false}>
          {[0, 1, 2].map((i) => (
            <mesh key={i} position={[Math.cos((i / 3) * Math.PI * 2) * 0.34, 0, Math.sin((i / 3) * Math.PI * 2) * 0.34]}>
              <sphereGeometry args={[0.03, 12, 8]} />
              <meshBasicMaterial color={style.glow} />
            </mesh>
          ))}
        </group>

        {/* Floor glow ring */}
        <mesh ref={glow} position={[0, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.62, 0.86, 64]} />
          <meshBasicMaterial color={style.glow} transparent opacity={0} depthWrite={false} toneMapped={false} />
        </mesh>
        <pointLight ref={light} position={[0, 2.4, 0.9]} color={style.glow} intensity={0} distance={5} decay={2} />
      </group>

      {/* Nameplate */}
      <Html position={[0, -0.05, 0.75]} center distanceFactor={9} zIndexRange={[10, 0]}>
        <button
          className={`nameplate ${status}`}
          style={{ '--accent': style.accent }}
          onClick={onSelect}
        >
          {standing && <span className={`rank-badge rank-${standing.rank}`}>#{standing.rank}</span>}
          <span className="nameplate-title">{title}</span>
          <span className="nameplate-sub">{subtitle}</span>
        </button>
      </Html>

      {speech && (
        <SpeechBubble
          key={speech.key}
          text={speech.text}
          accent={style.accent}
          position={[0, (emblemY + (isChair ? 0.9 : 0.5)) * style.scale, 0]}
          onSelect={onSelect}
        />
      )}
    </group>
  );
}
