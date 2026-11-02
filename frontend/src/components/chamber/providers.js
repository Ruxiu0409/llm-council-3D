/** Visual identity per model provider and tier. */

const PROVIDERS = {
  // Claude seats are Clawd, Claude Code's official mascot.
  claude: { accent: '#d77757', glow: '#ff9d76', body: '#5b382c', head: '#f1e6dc', emblem: 'spark', figure: 'clawd' },
  // Codex seats follow the official Codex app icon; the emblem is the OpenAI logo.
  codex: { accent: '#7b8cff', glow: '#a9b6ff', body: '#2e3766', head: '#e2e5f4', emblem: 'openai', emblemColor: '#f2f4f8', figure: 'codex' },
  gemini: { accent: '#6f8cff', glow: '#b18cff', body: '#2e3766', head: '#e2e5f4', emblem: 'star' },
};

const FALLBACK = { accent: '#a0a8b8', glow: '#d0d6e2', body: '#363b47', head: '#e6e8ec', emblem: 'orb' };

const TIERS = { fable: 1.14, opus: 1.08, sonnet: 1.0, haiku: 0.88 };

/** Style for a model id like "claude/opus". */
export function modelStyle(modelId = '') {
  const [provider, model = ''] = modelId.split('/');
  const base = PROVIDERS[provider] || FALLBACK;
  const tier = Object.keys(TIERS).find((t) => model.includes(t));
  return {
    figure: 'robot',
    ...base,
    provider,
    scale: TIERS[tier] || 1.0,
    crown: tier === 'fable',
    halo: tier === 'opus',
  };
}
