import { QuadraticBezierLine } from '@react-three/drei';
import { modelStyle } from './providers';

/** Arcs from each reviewer to the response they ranked first. */
export default function VoteArcs({ votes, positionOf, modelOf }) {
  return votes.map(({ from, to }) => {
    const a = positionOf(from);
    const b = positionOf(to);
    if (!a || !b) return null;
    const start = [a[0], 2.1, a[2]];
    const end = [b[0], 2.1, b[2]];
    const mid = [(a[0] + b[0]) / 2 * 0.4, 3.6, (a[2] + b[2]) / 2 * 0.4];
    return (
      <QuadraticBezierLine
        key={`${from}->${to}`}
        start={start}
        end={end}
        mid={mid}
        color={modelStyle(modelOf(from)).glow}
        lineWidth={2}
        dashed
        dashScale={8}
        transparent
        opacity={0.75}
        toneMapped={false}
      />
    );
  });
}
