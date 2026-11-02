import { useEffect, useState } from 'react';
import { Html } from '@react-three/drei';

const CHARS_PER_TICK = 2;
const TICK_MS = 50;

/** A speech bubble that types its text out, anchored above a speaker. */
export default function SpeechBubble({ text, accent, position, onSelect }) {
  const [shown, setShown] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setShown((n) => {
        if (n >= text.length) {
          clearInterval(id);
          return n;
        }
        return n + CHARS_PER_TICK;
      });
    }, TICK_MS);
    return () => clearInterval(id);
  }, [text]);

  return (
    <Html position={position} center distanceFactor={11} zIndexRange={[30, 20]}>
      <div className="speech-bubble" style={{ '--accent': accent }} onClick={onSelect}>
        {text.slice(0, shown)}
        {shown < text.length && <span className="speech-caret" />}
      </div>
    </Html>
  );
}
