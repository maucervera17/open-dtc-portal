// Provider selection for the recommendation agent. Pure: no SDK is imported here, so status and UI code can use it.
export const PROVIDERS = Object.freeze(['gemini', 'anthropic']);
export const DEFAULT_PROVIDER = 'gemini';
export const GEMINI_DEFAULT_MODEL = 'gemini-3.8-flash';
export const GEMINI_FALLBACK_DEFAULT_MODELS = Object.freeze(['gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash']);
export const ANTHROPIC_DEFAULT_MODEL = 'claude-opus-5-5';

// Unset selects the default. An unknown value returns null so the run fails closed instead of guessing a provider.
export function providerOf(env = {}) {
  const value = String(env.AGENT_PROVIDER ?? '').trim().toLowerCase();
  if (!value) return DEFAULT_PROVIDER;
  return PROVIDERS.includes(value) ? value : null;
}

export const keyVarOf = provider => (provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'GEMINI_API_KEY');
export const hasKey = (env, provider) => typeof env?.[keyVarOf(provider)] === 'string' && env[keyVarOf(provider)].trim() !== '';

// Each provider has its own model variable, so switching provider never sends one vendor's model name to the other.
export const modelOf = (env = {}, provider = DEFAULT_PROVIDER) => (provider === 'anthropic'
  ? env.AGENT_MODEL || ANTHROPIC_DEFAULT_MODEL
  : env.GEMINI_MODEL || GEMINI_DEFAULT_MODEL);

const MODEL_ID = /^gemini-[a-z0-9.-]{1,40}$/;
const validIds = text => [...new Set(String(text ?? '').split(',').map(id => id.trim()).filter(id => MODEL_ID.test(id)))];

// Models tried, in order, after the primary keeps failing with 503, 429, 500, 504 or a timeout.
// GEMINI_FALLBACK_MODELS is a comma-separated list; invalid ids are ignored. The legacy single GEMINI_FALLBACK_MODEL is
// a one-element list when the list variable is unset. Nothing valid means the default chain.
export function geminiFallbacksOf(env = {}) {
  const fromList = validIds(env.GEMINI_FALLBACK_MODELS);
  if (fromList.length) return fromList;
  if (!String(env.GEMINI_FALLBACK_MODELS ?? '').trim()) {
    const legacy = validIds(env.GEMINI_FALLBACK_MODEL);
    if (legacy.length) return legacy;
  }
  return [...GEMINI_FALLBACK_DEFAULT_MODELS];
}

// The primary first, then each fallback, never repeating a model.
export const geminiChainOf = (env = {}) => [...new Set([modelOf(env, 'gemini'), ...geminiFallbacksOf(env)])];
