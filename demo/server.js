// The local demo HTTP server: a plain Node server that serves public/ with the rewrites vercel.json defines and routes
// /api/* to the portal's real handlers, wired to an in-memory store and fake upstreams. It exists only for the demo
// entry script (`npm run demo`) and always binds to 127.0.0.1.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createDashHandler } from '../lib/dash/router.js';
import { createMediaHandler } from '../api/inspiration-media.js';
import { createPortalMcpHandler } from '../lib/mcp/server.js';
import { createSessions } from '../lib/auth/session.js';
import { COOKIE_NAME, readSid } from '../lib/auth/cookies.js';
import { placeholderPng } from './images.js';
import { DEMO_EMAIL } from './seed.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const ASSETS = path.join(ROOT, 'demo', 'assets');
const DEMO_COOKIE = 'dtc_demo_session';
const MAX_BODY = 15 * 1024 * 1024;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8', '.map': 'application/json',
};

// vercel.json is the source of truth for rewrites and response headers, so the demo behaves like the deployment.
async function loadVercelConfig() {
  const config = JSON.parse(await readFile(path.join(ROOT, 'vercel.json'), 'utf8'));
  const rewrites = (config.rewrites || []).map(({ source, destination }) => {
    const pattern = source.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/:(\w+)\*/g, '(?<$1>.*)').replace(/:(\w+)/g, '(?<$1>[^/]+)');
    return { regex: new RegExp(`^${pattern}$`), destination };
  });
  // Only catch-all header rules exist today; anything narrower is ignored rather than guessed. HSTS makes no sense over http.
  const headers = (config.headers || []).filter(h => h.source === '/(.*)').flatMap(h => h.headers).filter(h => h.key.toLowerCase() !== 'strict-transport-security');
  return { rewrites, headers };
}

function applyRewrite(url, rewrites) {
  for (const { regex, destination } of rewrites) {
    const match = regex.exec(url.pathname);
    if (!match) continue;
    const filled = destination.replace(/:(\w+)\*?/g, (_, name) => match.groups?.[name] ?? '');
    const target = new URL(filled, 'http://local');
    const query = new URLSearchParams(url.search);
    for (const [k, v] of target.searchParams) query.set(k, v);
    return { pathname: target.pathname, query };
  }
  return { pathname: url.pathname, query: new URLSearchParams(url.search) };
}

const demoCookie = (sid, maxAge) => `${DEMO_COOKIE}=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
// The portal sets `__Host-` cookies with Secure, which browsers will not keep over plain http. Both directions are
// translated here, at the edge of the demo server, so the portal's own cookie code stays untouched.
const outgoingCookie = value => String(value).replace(`${COOKIE_NAME}=`, `${DEMO_COOKIE}=`).replace(/;\s*Secure/i, '');
const incomingCookie = value => (typeof value === 'string' ? value.replace(new RegExp(`(^|;\\s*)${DEMO_COOKIE}=`, 'g'), `$1${COOKIE_NAME}=`) : value);

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) { const error = new Error('too large'); error.status = 413; throw error; }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

export async function createDemoServer({ env, store, fetch, agentClient, now = Date.now, port }) {
  const { rewrites, headers: baseHeaders } = await loadVercelConfig();
  const sessions = createSessions({ env, store, now });
  const handlers = {
    '/api/dash': createDashHandler({ env, store, fetch, agentClient, now }),
    '/api/inspiration-media': createMediaHandler({ env, storeFactory: () => store, fetcher: fetch }),
    '/api/mcp': createPortalMcpHandler({ env, store, now, fetch }),
  };
  const bannerTags = '<link rel="stylesheet" href="/demo/banner.css"><script src="/demo/banner.js" defer></script>';

  // A local session for the demo account, made with the portal's own session code. Reachable only through this server.
  async function ensureSession(req, res) {
    const sid = readSid(incomingCookie(req.headers.cookie));
    if (sid && await sessions.check(sid)) return;
    const created = await sessions.create(DEMO_EMAIL);
    res.setHeader('Set-Cookie', demoCookie(created.sid, created.maxAge));
    req.headers.cookie = `${COOKIE_NAME}=${created.sid}`;
  }

  async function serveStatic(req, res, pathname) {
    let relative;
    try { relative = decodeURIComponent(pathname); } catch { return send(res, 400, 'Bad request'); }
    if (relative.includes('\0') || relative.split('/').includes('..')) return send(res, 400, 'Bad request');
    let file = path.join(PUBLIC, relative);
    if (file !== PUBLIC && !file.startsWith(PUBLIC + path.sep)) return send(res, 400, 'Bad request');
    let info = await stat(file).catch(() => null);
    if (info?.isDirectory()) {
      if (!pathname.endsWith('/')) return send(res, 301, '', { Location: `${pathname}/` });
      file = path.join(file, 'index.html');
      info = await stat(file).catch(() => null);
    }
    if (!info?.isFile()) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
    const ext = path.extname(file).toLowerCase();
    let body = await readFile(file);
    if (ext === '.html') {
      if (pathname.startsWith('/app')) await ensureSession(req, res);
      const html = body.toString('utf8');
      body = Buffer.from(html.includes('</body>') ? html.replace('</body>', `${bannerTags}</body>`) : html + bannerTags);
    }
    return send(res, 200, body, { 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Content-Length': body.length });
  }

  async function serveApi(req, res, pathname, query) {
    const handler = handlers[pathname];
    if (!handler) return send(res, 404, JSON.stringify({ error: 'not_available_in_demo' }), { 'Content-Type': 'application/json; charset=utf-8' });
    req.query = Object.fromEntries(query);
    if (!['GET', 'HEAD'].includes(req.method)) {
      const raw = await readBody(req);
      const type = String(req.headers['content-type'] || '');
      req.body = raw && /^application\/json/i.test(type) ? (() => { try { return JSON.parse(raw); } catch { return raw; } })() : raw || undefined;
    }
    req.headers.cookie = incomingCookie(req.headers.cookie);
    const setHeader = res.setHeader.bind(res);
    res.setHeader = (name, value) => setHeader(name, String(name).toLowerCase() === 'set-cookie' ? [].concat(value).map(outgoingCookie) : value);
    res.status = code => { res.statusCode = code; return res; };
    res.json = body => { if (!res.hasHeader('content-type')) res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(body)); return res; };
    await handler(req, res);
  }

  const server = http.createServer(async (req, res) => {
    try {
      for (const { key, value } of baseHeaders) res.setHeader(key, value);
      const hostHeader = String(req.headers.host || '');
      const listening = server.address();
      const expectedPort = listening && typeof listening === 'object' ? listening.port : port;
      if (hostHeader === `localhost:${expectedPort}`) return send(res, 302, '', { Location: `http://127.0.0.1:${expectedPort}${req.url}` });
      // A name other than the loopback address means DNS rebinding or a proxy: refuse.
      if (hostHeader !== `127.0.0.1:${expectedPort}`) return send(res, 421, 'Misdirected request', { 'Content-Type': 'text/plain; charset=utf-8' });
      const remote = req.socket.remoteAddress;
      if (remote !== '127.0.0.1' && remote !== '::ffff:127.0.0.1') return send(res, 403, 'Forbidden');
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname === '/demo/login' && req.method === 'GET') {
        await ensureSession(req, res);
        return send(res, 302, '', { Location: '/app/', 'Cache-Control': 'no-store' });
      }
      if (url.pathname === '/demo/banner.js' || url.pathname === '/demo/banner.css') {
        const name = url.pathname.slice('/demo/'.length);
        return send(res, 200, await readFile(path.join(ASSETS, name)), { 'Content-Type': TYPES[path.extname(name)], 'Cache-Control': 'no-store' });
      }
      const media = /^\/demo-media\/([a-z0-9-]{1,80})\.png$/.exec(url.pathname);
      if (media) {
        const png = placeholderPng(media[1]);
        return send(res, 200, png, { 'Content-Type': 'image/png', 'Content-Length': png.length, 'Cache-Control': 'private, max-age=3600' });
      }
      const target = applyRewrite(url, rewrites);
      if (target.pathname.startsWith('/api/')) return await serveApi(req, res, target.pathname, target.query);
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
      res.setHeader('Cache-Control', 'no-store');
      return await serveStatic(req, res, url.pathname);
    } catch (error) {
      if (!res.headersSent) send(res, error?.status || 500, JSON.stringify({ error: error?.status === 413 ? 'payload_too_large' : 'internal' }), { 'Content-Type': 'application/json; charset=utf-8' });
      else res.destroy();
    }
  });
  return server;
}
