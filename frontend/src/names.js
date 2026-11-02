/**
 * Display name for a council seat or model.
 * Seat ids look like "claude/opus · Skeptic"; model ids like "claude/opus".
 */
export function shortName(id) {
  const [model, role] = id.split(' · ');
  const short = model.split('/')[1] || model;
  return role ? `${role} · ${short}` : short;
}
