import {collectInstagram} from '../lib/instagram.js';
import {selectCampaigns,shortEmail} from '../lib/streams.js';
import { randomUUID } from 'node:crypto';
import { authorized } from '../lib/auth/bearer.js';
import { localDate, recipientsFor } from '../lib/report.js';
import { collect } from '../lib/meta.js';
import { manualWindow } from '../lib/model.js';
import { makePdf } from '../lib/pdf.js';
const required = ['META_ACCESS_TOKEN','META_API_VERSION'];
export { authorized };
export default async function handler(req, res) {
  const env = process.env;
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!authorized(req.headers.authorization, env.REPORT_SECRET)) return res.status(401).json({ error: 'Unauthorized' });
  let body, window;
  let kind;
  let stage = 'validation';
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    kind=body?.kind||'sales';
    if(!['sales','social'].includes(kind))throw Error('kind');
    if (!['preview','send'].includes(body?.mode)) throw Error('mode');
    window = manualWindow(body.since, body.until);
    if (window.until >= localDate()) throw Error('Use completed days');
  } catch { return res.status(400).json({ error: 'Use mode preview or send, and 1-31 completed days (since/until YYYY-MM-DD)' }); }
  if (body.mode === 'send' && env.VERCEL_ENV && env.VERCEL_ENV !== 'production') return res.status(409).json({error:'Sending requires production'});
  if (body.mode === 'send' && env.REPORT_ENABLED !== 'true') return res.status(409).json({ error: 'Email sending disabled' });
  if (required.some(k => !env[k]) || !/^v\d+\.\d+$/.test(env.META_API_VERSION)) return res.status(503).json({ error: 'Configuration incomplete' });
  const redis = async command => {
    const response = await fetch(env.UPSTASH_REDIS_REST_URL, { method: 'POST', headers: { Authorization: `Bearer ${env.UPSTASH_REDIS_REST_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(command), signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error('Storage unavailable');
    const body = await response.json();
    if (body.error) throw new Error('Storage command failed');
    return body.result;
  };
  try {
    stage='collect';
    if (body.mode === 'preview') {
      const collected = await collect(window, env);
      const data=selectCampaigns(collected.data,kind),warnings=collected.warnings.filter(w=>data.some(c=>w.startsWith(c.name+' /')));
      if(!data.length)return res.status(200).json({status:'no_active_campaigns'});
      const instagram=kind==='social'?await collectInstagram(window,env):null;
      const pdf = await makePdf(window, data, warnings,{kind,instagram});
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=report-${kind}-${window.until}.pdf`);
      return res.status(200).send(pdf);
    }
    if (['RESEND_API_KEY','REPORT_FROM','UPSTASH_REDIS_REST_URL','UPSTASH_REDIS_REST_TOKEN'].some(k => !env[k])) return res.status(503).json({ error: 'Email configuration incomplete' });
    stage='storage';
    const key = `dtc:report:${env.META_AD_ACCOUNT_ID||'unset'}:${kind}:${window.since}:${window.until}`, lock = `${key}:lock`, owner = randomUUID();
    if (await redis(['GET', key])) return res.status(200).json({ status: 'already_sent' });
    if (!await redis(['SET', lock, owner, 'NX', 'EX', 600])) return res.status(200).json({ status: 'running' });
    try {
      if (await redis(['GET', key])) return res.status(200).json({ status: 'already_sent' });
      const payloadKey = `${key}:payload`;
      const attemptKey = `${key}:attempt`;
      const previousAttempt = await redis(['GET', attemptKey]);
      if (previousAttempt && Date.now()-Number(previousAttempt)>23*3600000) return res.status(409).json({error:'Ambiguous prior attempt; verify delivery in Resend before retrying'});
      let stablePayload = await redis(['GET', payloadKey]);
      if (!stablePayload) {
        stage='collect';
        const collected = await collect(window, env);
      const data=selectCampaigns(collected.data,kind),warnings=collected.warnings.filter(w=>data.some(c=>w.startsWith(c.name+' /')));
      if(!data.length)return res.status(200).json({status:'no_active_campaigns'});
        const instagram=kind==='social'?await collectInstagram(window,env):null;
        const report = shortEmail(window, data, kind,instagram);
        stage='pdf';
        const pdf = await makePdf(window, data, warnings,{kind,instagram});
        stablePayload = JSON.stringify({from:env.REPORT_FROM,to:recipientsFor(kind,env),...report,attachments:[{filename:`report-${kind}-${window.until}.pdf`,content:pdf.toString('base64')}]});
        if(Buffer.byteLength(stablePayload,'utf8')>900000) throw Error('Report too large for configured storage');
        stage='storage';
        await redis(['SET',payloadKey,stablePayload]);
      }
      await redis(['SET',attemptKey,String(Date.now()),'NX']);
      stage='email';
      const response = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: stablePayload, signal: AbortSignal.timeout(15000) });
      if (!response.ok) {
        // A definitive rejection did not accept the email; allow a later attempt.
        // Timeouts, server errors and conflicts remain ambiguous and keep the marker.
        if([400,401,403,404,422,429].includes(response.status)) await redis(['DEL',attemptKey]);
        throw new Error('Email submission failed');
      }
      const sent = await response.json();
      if (!sent.id) throw new Error('Email acknowledgement missing');
      stage='record_acceptance';
      await redis(['SET', key, JSON.stringify({ id: sent.id, at: new Date().toISOString() })]);
      return res.status(200).json({ status: 'accepted_by_email_provider' });
    } finally {
      try { await redis(['EVAL', 'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end', 1, lock, owner]); } catch { console.error('report_lock_release_failed'); }
    }
  } catch {
    // Never return or log tokens, Graph URLs, or report contents.
    console.error('meta_report_failed', {stage});
    return res.status(502).json({ error: 'Report failed; requires review' });
  }
}
