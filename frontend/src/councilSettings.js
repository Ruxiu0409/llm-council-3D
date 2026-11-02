/** Per-run council settings: budget tiers, persistence, and API mapping. */

// v2: budgets became first-class; older saved settings are ignored.
const STORAGE_KEY = 'llm-council-settings-v2';

/** Expand a server-defined budget tier into panel state. */
export function fromBudget(council, key) {
  const tier = council.budgets[key];
  return {
    budget: key,
    models: tier.models,
    chairman: tier.chairman,
    seats: tier.seats,
    maxSeats: tier.max_seats || council.limits.max,
    effort: tier.effort,
  };
}

/** Saved settings if still valid, else the server's default budget. */
export function initialSettings(council) {
  const fallback = fromBudget(council, council.default_budget);
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved) return fallback;
    if (saved.budget && saved.budget !== 'custom' && council.budgets[saved.budget]) {
      return fromBudget(council, saved.budget);
    }
    const ids = council.catalog.map((m) => m.id);
    const models = (saved.models || []).filter((id) => ids.includes(id));
    if (!models.length) return fallback;
    return {
      budget: 'custom',
      models,
      chairman: ids.includes(saved.chairman) ? saved.chairman : fallback.chairman,
      seats: saved.seats ?? null,
      maxSeats: saved.maxSeats ?? fallback.maxSeats,
      effort: council.efforts.includes(saved.effort) ? saved.effort : null,
    };
  } catch {
    return fallback;
  }
}

export function saveSettings(settings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

/** Request fields for the API. Everything is explicit, so the server default can't change it. */
export function toRequest(settings) {
  return {
    models: settings.models,
    chairman: settings.chairman,
    seats: settings.seats,
    max_seats: settings.seats ? null : settings.maxSeats,
    effort: settings.effort,
  };
}

/** Model calls a run will make: planner + an answer and a review per seat + chairman. */
export function callEstimate(settings, limits) {
  const calls = (seats) => 1 + seats * 2 + 1;
  if (settings.seats) return `${calls(settings.seats)} 次`;
  return `${calls(limits.min)}–${calls(settings.maxSeats)} 次`;
}

export const EFFORT_LABELS = {
  low: '淺',
  medium: '中',
  high: '深',
  xhigh: '很深',
  max: '最深',
};
