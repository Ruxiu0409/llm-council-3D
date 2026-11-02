import { useEffect, useMemo, useState } from 'react';
import { shortName } from '../../names';

const CHARS_PER_SECOND = 38;
const EXCERPT_LENGTH = 240;
const HOLD_SECONDS = 2.2;

/** Strip markdown down to plain text for speech bubbles. */
export function plainText(markdown = '') {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^#+\s*/gm, '')
    .replace(/[*_`>]+/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s*[-+]\s+/gm, '• ')
    .replace(/\s+/g, ' ')
    .trim();
}

function excerpt(text) {
  const plain = plainText(text);
  return plain.length > EXCERPT_LENGTH ? `${plain.slice(0, EXCERPT_LENGTH)}…` : plain;
}

export const CHAIR = 'chair';

/** Everything said in the chamber, in speaking order. */
function buildUtterances(msg) {
  if (!msg) return [];
  const labelToModel = msg.metadata?.label_to_model || {};
  const out = [];
  const plan = msg.metadata?.plan;
  if (plan) {
    out.push({
      key: 'plan',
      speaker: CHAIR,
      stage: 0,
      text: `開 ${plan.seats.length} 席。${plan.reason || ''}`,
    });
  }
  for (const r of msg.stage1 || []) {
    out.push({ key: `s1:${r.model}`, speaker: r.model, stage: 1, text: excerpt(r.response) });
  }
  for (const r of msg.stage2 || []) {
    const order = (r.parsed_ranking || [])
      .map((label) => labelToModel[label])
      .filter(Boolean)
      .map((seat, i) => `${i + 1}. ${shortName(seat)}`);
    const text = order.length
      ? `我的排名：${order.join('　')}`
      : excerpt(r.ranking);
    out.push({ key: `s2:${r.model}`, speaker: r.model, stage: 2, text });
  }
  if (msg.stage3) {
    out.push({ key: 's3', speaker: CHAIR, stage: 3, text: excerpt(msg.stage3.response) });
  }
  return out;
}

function speakingSeconds(text, backlog) {
  const seconds = text.length / CHARS_PER_SECOND + HOLD_SECONDS;
  // Catch up quickly when several seats are waiting to speak (e.g. joining mid-run).
  return backlog > 1 ? Math.min(seconds, 2.5) : Math.min(seconds, 14);
}

/**
 * Derive the chamber state from the latest assistant message:
 * who sits where, who is thinking, and who is speaking right now.
 *
 * Live messages are spoken one utterance at a time. Messages loaded from
 * storage start finished; `replay()` plays them back. Mount one per
 * conversation (key by id) so switching conversations resets the queue.
 */
export function useCouncilScene(msg, chairmanId) {
  const utterances = useMemo(() => buildUtterances(msg), [msg]);
  const isLive = Boolean(msg?.loading);

  const [spokenKeys, setSpokenKeys] = useState(() => new Set());
  const [replaying, setReplaying] = useState(false);
  const playing = isLive || replaying;

  // When not playing, everything counts as already said.
  const spoken = playing ? spokenKeys : new Set(utterances.map((u) => u.key));
  const queue = utterances.filter((u) => !spoken.has(u.key));
  const current = playing ? queue[0] || null : null;

  // Let the current speaker finish, then move on to the next.
  const currentKey = current?.key;
  const duration = current ? speakingSeconds(current.text, queue.length) : 0;
  const isLast = queue.length === 1;
  useEffect(() => {
    if (!currentKey) return;
    const id = setTimeout(() => {
      setSpokenKeys((prev) => new Set(prev).add(currentKey));
      if (isLast && !isLive) setReplaying(false);
    }, duration * 1000);
    return () => clearTimeout(id);
  }, [currentKey, duration, isLast, isLive]);

  const replay = () => {
    setSpokenKeys(new Set());
    setReplaying(true);
  };

  const plan = msg?.metadata?.plan;
  const seats = plan?.seats || [];
  const pending = new Set(msg?.pending || []);
  const stage1Done = Boolean(msg?.stage1) && !msg?.loading?.stage1;
  const answered = new Set((msg?.stage1 || []).map((r) => r.model));

  const seatStatus = (seatId) => {
    if (current?.speaker === seatId) return 'speaking';
    if (pending.has(seatId)) return 'thinking';
    if (stage1Done && !answered.has(seatId)) return 'absent';
    return 'idle';
  };

  const chairStatus =
    current?.speaker === CHAIR
      ? 'speaking'
      : msg?.loading?.stage0 || msg?.loading?.stage3
        ? 'thinking'
        : 'idle';

  // Each spoken review points at the reviewer's top pick.
  const labelToModel = msg?.metadata?.label_to_model || {};
  const votes = (msg?.stage2 || [])
    .filter((r) => spoken.has(`s2:${r.model}`) || current?.key === `s2:${r.model}`)
    .map((r) => ({ from: r.model, to: labelToModel[r.parsed_ranking?.[0]] }))
    .filter((v) => v.to && v.to !== v.from);

  const aggregate = msg?.metadata?.aggregate_rankings || [];
  const reviewsSpoken = (msg?.stage2 || []).every((r) => spoken.has(`s2:${r.model}`));
  const standings =
    aggregate.length && reviewsSpoken
      ? Object.fromEntries(aggregate.map((a, i) => [a.model, { rank: i + 1, avg: a.average_rank }]))
      : {};

  let stage = null;
  if (msg?.loading?.stage0) stage = 0;
  else if (msg?.loading?.stage1) stage = 1;
  else if (msg?.loading?.stage2) stage = 2;
  else if (msg?.loading?.stage3) stage = 3;
  if (current) stage = current.stage;
  if (stage === null && msg?.stage3) stage = 4;

  return {
    seats,
    chairmanId: msg?.stage3?.model || msg?.metadata?.settings?.chairman || chairmanId,
    current,
    seatStatus,
    chairStatus,
    votes,
    standings,
    stage,
    canReplay: !isLive && utterances.length > 0 && !replaying,
    replay,
  };
}
