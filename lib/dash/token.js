import { dayMs } from '../dates.js';

export const TOKEN_WARNING_DAYS = 14;

// Known expiry of the user token (META_TOKEN_EXPIRES_AT, YYYY-MM-DD) and whether to warn about it. Unset means no warning.
export function tokenExpiry(env, nowMs) {
  // Set only after configuring a system-user token with expiration "Never" in Meta.
  if (env.META_TOKEN_EXPIRES_AT === 'never') {
    return { token_expires_at: null, token_warning: false };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(env.META_TOKEN_EXPIRES_AT || '')) return { token_expires_at: null, token_warning: false };
  const raw = env.META_TOKEN_EXPIRES_AT;
  const daysLeft = (Date.parse(raw) - nowMs) / dayMs;
  return { token_expires_at: raw, token_warning: Number.isFinite(daysLeft) && daysLeft <= TOKEN_WARNING_DAYS };
}
