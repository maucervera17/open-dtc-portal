import { graphUrl, metaGet } from './meta-client.js';
import {
  accountValues, buildProfile, envOverrides, readStoredProfile, recordAccountProfile, setActiveProfile, activeProfile, isResolvedProfile, spendUnit, FALLBACK_PROFILE,
} from './locale.js';

// Reads the ad account's own currency and time zone from Graph (the same read-only call the collectors always made).
// Returns the validated { currency, timezone }, or null when the account answers with something unusable.
export async function fetchAccountValues({ env, fetch: fetcher = fetch, accountId = env.META_AD_ACCOUNT_ID }) {
  const account = String(accountId || '');
  if (!/^\d+$/.test(account)) throw new Error('Invalid account ID');
  const response = await metaGet(graphUrl(env.META_API_VERSION, `act_${account}`, { fields: 'id,currency,timezone_name' }), { token: env.META_ACCESS_TOKEN, fetch: fetcher });
  if (!response.ok) throw new Error('Account metadata unavailable');
  const info = await response.json();
  if (info?.id !== `act_${account}`) throw new Error('Account metadata mismatch');
  return accountValues(info);
}

const metaConfigured = env => typeof env.META_ACCESS_TOKEN === 'string' && env.META_ACCESS_TOKEN !== '' && /^\d+$/.test(String(env.META_AD_ACCOUNT_ID ?? '')) && /^v\d+\.\d+$/.test(String(env.META_API_VERSION ?? ''));

// The profile every handler runs with: overrides first, then what Redis remembers about the account, then (only when allowed and
// still unknown or older than an hour) one Graph read, so a changed account currency or time zone is picked up and recorded (with
// its warning) instead of being masked by the stored value. It becomes the process-wide active profile. A bad REPORT_CURRENCY /
// REPORT_TIMEZONE throws ConfigError. When nothing can be resolved the result is `resolved: false` on a UTC / USD fallback: callers
// that write or send things (crons, reports) must stop on it, and the fallback never replaces an already resolved profile.
export async function resolveProfile({ env = process.env, store, fetch: fetcher = fetch, now = Date.now, allowFetch = true } = {}) {
  const overrides = envOverrides(env);
  const accountId = String(env.META_AD_ACCOUNT_ID ?? '');
  let account = null;
  let change = null;
  let fresh = false;
  if (/^\d+$/.test(accountId)) {
    if (store) {
      try { ({ stored: account, change, fresh } = await readStoredProfile(store, accountId)); } catch { /* storage down: try Meta */ }
    }
    if ((!account || !fresh) && allowFetch && !(overrides.currency && overrides.timezone) && metaConfigured(env)) {
      try {
        const read = await fetchAccountValues({ env, fetch: fetcher, accountId });
        if (read) {
          account = read;
          if (store) ({ change } = await recordAccountProfile({ store, accountId, account, now }));
        }
      } catch { /* Meta unreachable: keep the stored values (if any), else fall back below */ }
    }
  }
  const profile = buildProfile(account, overrides);
  if (!profile) {
    // Nothing resolved now, but this process already knows the (single) account: keep using it rather than UTC.
    if (isResolvedProfile(activeProfile())) return { profile: activeProfile(), change, resolved: true };
    const fallback = { ...FALLBACK_PROFILE, ...(overrides.currency ? { currency: overrides.currency } : {}), ...(overrides.timezone ? { timezone: overrides.timezone } : {}) };
    return { profile: setActiveProfile(fallback), change, resolved: false };
  }
  return { profile: setActiveProfile(profile), change, resolved: true };
}

// The shape the API and the UI receive.
export const publicProfile = ({ profile, change, resolved }) => ({
  currency: profile.currency, timezone: profile.timezone, source: profile.source, resolved, spend_unit: spendUnit(profile.currency),
  warning: change ? { code: 'account_changed', from: change.from, to: change.to, at: change.at } : null,
});
