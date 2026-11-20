import { createAnthropicClient, callAgent } from './anthropic.js';
import { createGeminiClient, callGemini } from './gemini.js';

// One interface over the providers: a client is built from the environment (or injected in tests) and `call` returns
// `{ ok, output, served_by, usage }` or `{ ok: false, stage, ... }`. Both implementations have no tools and no Meta access.
const IMPLEMENTATIONS = { gemini: { create: createGeminiClient, call: callGemini }, anthropic: { create: createAnthropicClient, call: callAgent } };

export const createProviderClient = (provider, env) => IMPLEMENTATIONS[provider].create(env);
export const callProvider = (provider, args) => IMPLEMENTATIONS[provider].call(args);
