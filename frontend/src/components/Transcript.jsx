import { useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import Stage0 from './Stage0';
import Stage1 from './Stage1';
import Stage2 from './Stage2';
import Stage3 from './Stage3';
import { CHAIR } from './chamber/useCouncilScene';
import './Transcript.css';

/** Full written record of a council session; `focus` scrolls to a seat or the chairman. */
export default function Transcript({ question, message, focus }) {
  const stage1Ref = useRef(null);
  const stage3Ref = useRef(null);

  useEffect(() => {
    if (!focus) return;
    const el = focus.seat === CHAIR ? stage3Ref.current : stage1Ref.current;
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [focus]);

  return (
    <div className="transcript">
      {question && (
        <div className="transcript-question">
          <div className="transcript-label">提問</div>
          <div className="markdown-content">
            <ReactMarkdown>{question}</ReactMarkdown>
          </div>
        </div>
      )}
      {message && (
        <>
          <Stage0 plan={message.metadata?.plan} />
          <div ref={stage1Ref}>
            <Stage1
              responses={message.stage1}
              focus={focus && focus.seat !== CHAIR ? { model: focus.seat, at: focus.at } : null}
            />
          </div>
          {message.stage2 && (
            <Stage2
              rankings={message.stage2}
              labelToModel={message.metadata?.label_to_model}
              aggregateRankings={message.metadata?.aggregate_rankings}
            />
          )}
          <div ref={stage3Ref}>
            <Stage3 finalResponse={message.stage3} />
          </div>
        </>
      )}
    </div>
  );
}
