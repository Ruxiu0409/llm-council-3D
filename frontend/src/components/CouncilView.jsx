import { lazy, Suspense, useState } from 'react';
import Transcript from './Transcript';
import CouncilSettings from './CouncilSettings';
import { initialSettings, toRequest } from '../councilSettings';
import { CHAIR, plainText, useCouncilScene } from './chamber/useCouncilScene';
import { shortName } from '../names';
import './CouncilView.css';

const Chamber = lazy(() => import('./chamber/Chamber'));

const STAGES = ['組成議會', '各自陳述', '匿名互評', '主席裁決'];

function Stepper({ stage }) {
  return (
    <ol className="stepper">
      {STAGES.map((label, i) => {
        const state = stage === null ? '' : stage > i ? 'done' : stage === i ? 'active' : '';
        return (
          <li key={label} className={`step ${state}`}>
            <span className="step-index">{i}</span>
            <span className="step-label">{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

function Composer({ onSend, disabled, council }) {
  const [input, setInput] = useState('');
  const [settings, setSettings] = useState(() => (council?.defaults ? initialSettings(council) : null));
  const submit = (e) => {
    e.preventDefault();
    if (input.trim() && !disabled) {
      onSend(input, settings ? toRequest(settings) : {});
      setInput('');
    }
  };
  return (
    <form className="composer" onSubmit={submit}>
      <div className="composer-title">要讓議會討論什麼？</div>
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) submit(e);
        }}
        placeholder="輸入問題，Enter 送出，Shift+Enter 換行"
        rows={3}
        disabled={disabled}
        autoFocus
      />
      {settings && <CouncilSettings council={council} settings={settings} onChange={setSettings} />}
      <button type="submit" className="composer-submit" disabled={!input.trim() || disabled}>
        召開議會
      </button>
    </form>
  );
}

/** The council chamber for one conversation: 3D scene, HUD, and transcript drawer. */
export default function CouncilView({ conversation, onSendMessage, isLoading, council }) {
  const messages = conversation?.messages || [];
  const question = messages.find((m) => m.role === 'user')?.content;
  const message = messages.findLast((m) => m.role === 'assistant');
  const scene = useCouncilScene(message, council?.defaults?.chairman);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [focus, setFocus] = useState(null);

  const openSeat = (seat) => {
    setFocus({ seat, at: Date.now() });
    setDrawerOpen(true);
  };

  const speaker = scene.current?.speaker;
  const speakerName =
    speaker === CHAIR
      ? `主席 · ${shortName(scene.chairmanId || '')}`
      : speaker && shortName(speaker);
  const pending = (message?.pending || []).map(shortName);

  return (
    <div className="council-view">
      <div className="chamber-canvas">
        <Suspense fallback={<div className="chamber-loading">議事廳準備中…</div>}>
          <Chamber scene={scene} onSelect={openSeat} />
        </Suspense>
      </div>

      {!conversation && (
        <div className="hud-center">
          <h2>LLM Council</h2>
          <p>從左側建立新的議會開始</p>
        </div>
      )}

      {conversation && messages.length === 0 && (
        <div className="hud-center">
          <Composer
            key={council ? 'ready' : 'loading'}
            onSend={onSendMessage}
            disabled={isLoading}
            council={council}
          />
        </div>
      )}

      {message && (
        <div className="hud-top">
          <Stepper stage={scene.stage} />
          {pending.length > 0 && !scene.current && (
            <div className="hud-pending">等待 {pending.join('、')}</div>
          )}
        </div>
      )}

      {question && (
        <div className="hud-question" title={question}>
          <span className="hud-question-label">議題</span>
          <span className="hud-question-text">{question}</span>
        </div>
      )}

      {speakerName && (
        <div className="hud-speaker">
          <span className="live-dot" />
          {speakerName} 發言中
        </div>
      )}

      {!scene.current && message?.stage3 && (
        <button className="hud-verdict" onClick={() => openSeat(CHAIR)}>
          <span className="hud-verdict-label">主席裁決 · {shortName(message.stage3.model)}</span>
          <span className="hud-verdict-text">{plainText(message.stage3.response)}</span>
          <span className="hud-verdict-more">看完整裁決 →</span>
        </button>
      )}

      {message?.error && <div className="hud-error">議會中斷：{message.error}</div>}

      {message && (
        <div className="hud-actions">
          {scene.canReplay && (
            <button className="hud-button" onClick={scene.replay}>
              重播
            </button>
          )}
          <button className="hud-button primary" onClick={() => setDrawerOpen((o) => !o)}>
            {drawerOpen ? '關閉逐字稿' : '逐字稿'}
          </button>
        </div>
      )}

      <aside className={`transcript-drawer ${drawerOpen ? 'open' : ''}`}>
        <div className="drawer-header">
          <span>逐字稿</span>
          <button onClick={() => setDrawerOpen(false)} aria-label="關閉逐字稿">
            ×
          </button>
        </div>
        <div className="drawer-body">
          <Transcript question={question} message={message} focus={focus} />
        </div>
      </aside>
    </div>
  );
}
