import { createTokens } from '../mcp/tokens.js';
import { storage } from '../schedule.js';
import { createSessions } from '../auth/session.js';
import { createMagicLinks } from '../auth/magic-link.js';
import { readSid, sessionCookie, clearCookie } from '../auth/cookies.js';
import { originAllowed, isJson } from '../auth/origin.js';
import * as V from './validate.js';
import { today } from './range.js';
import { logEvent } from './log.js';
import { dataRoutes } from './routes.js';
import { tokenExpiry } from './token.js';
import { runAfter } from './after.js';
import { brandName } from '../brand.js';
import { resolveProfile, publicProfile } from '../account-profile.js';
import { ConfigError } from '../locale.js';

export const LOGIN_FLOOR_MS = 1500;
function clientIp(headers) {
  return String(headers['x-real-ip'] || String(headers['x-vercel-forwarded-for'] || '').split(',')[0] || '').trim() || 'unknown';
}

function bodyOf(req) {
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { throw new V.BadRequestError(); } }
  return body && typeof body === 'object' && !Array.isArray(body) ? body : {};
}

// `routes` lets later work units register data handlers: name -> async ctx => ({status, body}).
export function createDashHandler({
  env = process.env, store, fetch: fetcher = (...args) => globalThis.fetch(...args), now = Date.now, sleep, timeoutSignal, routes = dataRoutes, agentClient,
} = {}) {
  const wait = sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const signal = timeoutSignal || (ms => AbortSignal.timeout(ms));

  return async function handler(req, res) {
    const respond = (code, body) => {
      if (code === 204) return res.status(204).end();
      return res.status(code).json(body);
    };
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Vary', 'Cookie');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    // The first statement of substance: no storage, Meta, Resend or Anthropic call happens while disabled.
    if (env.DASH_ENABLED !== 'true') return respond(404, { error: 'disabled' });

    try {
      const headers = req.headers || {};
      const spec = V.route(req.query?.r);
      if (req.method !== spec.method) return respond(405, { error: 'method_not_allowed' });
      const nowMs = Number(now());
      const db = store || storage(env);

      let body = {};
      if (spec.method === 'POST') {
        if (!originAllowed(headers, env.DASH_BASE_URL)) return respond(403, { error: 'forbidden' });
        if (!isJson(headers)) return respond(415, { error: 'unsupported_media_type' });
        if (spec.body || spec.fromBody) body = bodyOf(req);
      }
      let input = {};
      // Auth routes never depend on the account profile: no profile read, and a bad REPORT_* value cannot block sign-in.
      if (spec.name === 'auth/request') input = { email: V.email(body.email) };
      else if (spec.name === 'auth/consume') input = { token: V.token(body.token) };

      const sessions = createSessions({ env, store: db, now });
      const magic = createMagicLinks({ env, store: db, fetch: fetcher, timeoutSignal: signal, sessions });

      if (spec.name === 'auth/request') {
        const started = Number(now());
        try { await magic.request({ email: input.email, ip: clientIp(headers) }); } catch { logEvent('dash_login', { stage: 'request', code: 'failed' }); }
        const remaining = LOGIN_FLOOR_MS - (Number(now()) - started);
        if (remaining > 0) await wait(remaining);
        return respond(200, { status: 'ok' });
      }
      if (spec.name === 'auth/consume') {
        const session = await magic.consume(input.token);
        if (!session) return respond(400, { error: 'invalid_or_expired' });
        res.setHeader('Set-Cookie', sessionCookie(session.sid, session.maxAge));
        return respond(200, { email: session.email });
      }

      const sid = readSid(headers.cookie);
      const session = sid ? await sessions.check(sid) : null;
      if (!session) {
        res.setHeader('Set-Cookie', clearCookie());
        return respond(401, { error: 'unauthorized' });
      }
      if (session.cookieMaxAge !== null) res.setHeader('Set-Cookie', sessionCookie(sid, session.cookieMaxAge));
      // Only a signed-in user gets here, so the profile (Redis, and when stale or unknown one Meta read) is resolved now, and the
      // date parameters are validated against the real "today" of the account's time zone.
      const resolved = await resolveProfile({ env, store: db, fetch: fetcher, now });
      const D = today(nowMs);
      if (spec.name !== 'auth/logout') input = V.params(spec, spec.fromBody ? body : req.query, D);

      if (spec.name.startsWith('mcp/')) {
        const tokens=createTokens({env,store:db,now});
        try {
          if(spec.name==='mcp/tokens')return respond(200,{tokens:await tokens.list(session.email)});
          if(spec.name==='mcp/create')return respond(201,await tokens.create(session.email,body.name,body.scope));
          if(spec.name==='mcp/revoke'){await tokens.revoke(session.email,body.id);return respond(200,{ok:true});}
        } catch(error) {
          if(['invalid_name','invalid_id','invalid_scope','token_limit'].includes(error.message))return respond(400,{error:error.message});
          throw error;
        }
      }
      if (spec.name === 'auth/logout') {
        await sessions.destroy(sid, session.email);
        res.setHeader('Set-Cookie', clearCookie());
        return respond(204);
      }
      if (spec.name === 'me') {
        return respond(200, {
          email: session.email,
          brand: brandName(env),
          token_warning: tokenExpiry(env, nowMs).token_warning,
          profile: publicProfile(resolved),
          flags: { inspiration: env.INSPIRATION_ENABLED === 'true', agent: env.AGENT_ENABLED === 'true', emq: Boolean(env.META_SYSTEM_USER_TOKEN), targets: Boolean(env.TARGET_CPA || env.TARGET_ROAS) },
        });
      }
      const routed = routes[spec.name];
      if (!routed) return respond(404, { error: 'not_found' });
      const out = await routed({ req, env, store: db, now, fetch: fetcher, sleep: wait, D, profile: resolved, email: session.email, params: input, agentClient, timeoutSignal: signal });
      respond(out.status, out.body);
      // Work the route wants done once the user already has the response (summaries, memory proposals).
      if (typeof out.after === 'function') await runAfter(out.after);
      return;
    } catch (error) {
      if (error instanceof V.BadRequestError) return respond(400, { error: 'bad_request' });
      if (error instanceof ConfigError) { logEvent('dash_error', { stage: 'config', code: error.variable ?? 'config' }); return respond(500, { error: 'config_invalid' }); }
      logEvent('dash_error', { stage: 'handler' });
      return respond(500, { error: 'internal' });
    }
  };
}
