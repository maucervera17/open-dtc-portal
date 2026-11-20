# Open DTC Portal

An open-source, self-hosted portal for a direct-to-consumer (DTC) brand. It does two jobs in one place:

1. **Measure your own campaigns**: Meta Ads performance, sales, pixel health, Instagram, alerts, and an AI analyst with memory and a daily journal.
2. **Study the competition**: a creative-intelligence module that tracks competitor ads from the Meta Ad Library (radar, saved library, AI analysis, daily production plan).

It is an open, self-hosted alternative inspired by tools such as Atria. It is not affiliated with, endorsed by, or derived from any of them.

> **The UI is in Spanish** (es-MX), and the product is built around Meta Ads accounts that use **MXN** and the **America/Mexico_City** time zone. See [Scope and limits](#scope-and-limits).

---

## Contents

- [Feature tour](#feature-tour)
- [Architecture](#architecture)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [Cron jobs](#cron-jobs)
- [MCP server (Claude Code, Codex)](#mcp-server-claude-code-codex)
- [Chrome extension: Ad Saver](#chrome-extension-ad-saver)
- [Scope and limits](#scope-and-limits)
- [Third-party licenses](#third-party-licenses)
- [Contributing](#contributing) / [License](#license)

---

## Feature tour

Sidebar names are the Spanish labels you will see in the app.

### Your performance

| View | What it does |
|---|---|
| **Resumen** | KPI summary for a date range (purchases, spend, cart adds, CPA, ROAS, link CTR) compared with the previous period, plus the purchase funnel. |
| **Analíticas** | Creative analytics: tag ads (message, format, offer, narrative...), see mix diversity, set a goal, save reports, and compare an ad against its landing page with AI (landing fetch is restricted to `LANDING_HOSTS`). |
| **Campañas** | Campaign table with spend, purchases and CTR; each campaign is judged by its own objective (sales, traffic, profile growth, engagement, leads, awareness). |
| **Creativos** | Ads and creatives with delivery status (running, no delivery, finished), metrics and previews. |
| **Píxel** | Funnel events from the Meta pixel (product views, cart adds, checkouts, purchases) and Event Match Quality when a system-user token is configured. |
| **Alertas** | Daily alerts and AI recommendations (stop, continue, scale, replace creative, watch). Read/unread state per user. |
| **Preguntar** | AI chat analyst. Conversations are private per user, ground their answers in your data, and can cite ads. Includes **memory** (shared brand notes, proposed by the AI and approved by a human) and a **journal** of daily recommendations. |
| **Redes** | Instagram growth and reach, followers gained and lost, best posts. |
| **Conectores** | Create personal read-only keys for the [MCP server](#mcp-server-claude-code-codex). |

### Creative intelligence (Inspiración)

Enable with `INSPIRATION_ENABLED=true`. Everything starts **empty**: you add the competitor brands you care about.

- **Radar**: formats, copy openings, landing URLs (UTM stripped), launches by date and how long ads have been running.
- **Saved library (Guardados)**: favourites, boards, notes, and optional private archiving of image/video to Vercel Blob (256 MB cumulative budget).
- **AI analysis**: per-ad breakdown (hook, angle, offer, hypothesis, brief) from copy or the actual media (including audio transcription via Gemini, or local Whisper). AI output is treated as inference, not fact.
- **Daily production plan**: three actionable hypotheses with script, shots, hooks and a test design, built from competitor evidence plus your own recent results. If every model fails, a clearly labelled rule-based plan is shown instead.
- **Discovery**: search the Meta Ad Library through a third-party API (ScrapeCreators) with country, media, status and language filters.
- **Cron follow-up**: optional daily refresh for brands flagged `auto:true`.

Competitor data is public ad observations. The portal never infers a competitor's sales, spend or profitability.

---

## Architecture

```
Browser (vanilla ES-module SPA, /public/app)         Chrome extension (Ad Saver)
        │  session cookie                                      │
        ▼                                                      ▼
Vercel Functions (Node 22)  ── api/dash.js (single router), api/mcp.js, api/report.js, *-cron.js
        │
        ├── Upstash Redis (REST)      all state: sessions, snapshots, memory, journal, library
        ├── Vercel Blob (private)     optional archived ad media
        ├── Meta Graph / Marketing API   campaigns, ads, pixel, Instagram
        ├── Gemini (@google/genai)    default model for the agent, analysis and plans
        ├── Anthropic (@anthropic-ai/sdk)  optional alternative provider for the agent
        ├── ScrapeCreators API        Meta Ad Library search (paid credits)
        ├── Resend                    sign-in links and email reports
        └── api/whisper.py (Python)   optional local transcription (faster-whisper)
```

- **No database server and no build step for the front end.** `public/` is served as-is; `api/*.js` are Vercel functions.
- **Auth**: passwordless magic link by email, restricted to an allowlist (`DASH_ALLOWED_EMAILS`). Sessions are HMAC-keyed in Redis.
- **Safety by design**: the Meta integration is read-only, the MCP server is read-only, and media proxying only accepts Meta CDN hosts over HTTPS with no redirects.

Main folders: `api/` (functions), `lib/` (server logic, agent, auth, inspiration, MCP), `public/app/` (SPA), `chrome-extension/`, `scripts/` (MCP bridge), `services/transcription/` (Whisper), `test/`.

---

## Quick start

**Requirements:** Node 22, a Meta ad account (MXN, `America/Mexico_City`) with an access token, an Upstash Redis database, and a Resend account for sign-in emails.

### Run the tests

```sh
npm install
npm test
```

Tests use in-memory stores and fictional data; no network or credentials needed.

### Deploy to Vercel

1. Fork or clone this repo and import it in Vercel (framework preset: **Other**; the output directory `public` is already set in `vercel.json`).
2. Create an Upstash Redis database (the Vercel Marketplace integration works) and copy its REST URL and token.
3. In **Settings → Environment Variables**, add the variables from [`env.example`](env.example). The minimum to sign in and see data:
   `DASH_ENABLED=true`, `DASH_BASE_URL`, `DASH_SESSION_SECRET`, `DASH_ALLOWED_EMAILS`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `META_AD_ACCOUNT_ID`, `META_ACCESS_TOKEN`, `RESEND_API_KEY`, `REPORT_FROM`.
4. Add `CRON_SECRET` (any long random string) so the scheduled jobs are authorized.
5. Deploy, then open `https://<your-domain>/app/`.

Meta token and permissions: see [docs/meta-setup.md](docs/meta-setup.md).

> `vercel.json` runs `services/transcription/download_model.py` as the build command, which downloads the Whisper model from Hugging Face. If you do not need local transcription, remove `buildCommand` and the `api/whisper.py` entries from `vercel.json`.

### Run locally

The app is a set of Vercel functions, so the simplest local loop is the Vercel CLI:

```sh
cp env.example .env.local     # fill in values
npx vercel dev
```

Sign-in links are emailed through Resend, so local sign-in also needs `RESEND_API_KEY` and a verified `REPORT_FROM`.

---

## Configuration

Every environment variable the code reads. All are listed, with empty values, in [`env.example`](env.example).

**Core**

| Variable | Required | Purpose |
|---|---|---|
| `DASH_ENABLED` | yes | `true` turns the portal and MCP endpoint on. |
| `DASH_BASE_URL` | yes | Public origin, e.g. `https://portal.example.com`. Used for links and origin checks. |
| `DASH_SESSION_SECRET` | yes | 32+ bytes. Signs sessions, MCP keys and Whisper requests. |
| `DASH_ALLOWED_EMAILS` | yes | Comma-separated emails allowed to sign in. |
| `DASH_ADDITIONAL_EMAILS`, `DASH_TEAM_EMAILS` | no | More allowed emails, merged and de-duplicated. Max 20 in total. |
| `BRAND_NAME` | no | Brand shown in UI header, emails, PDFs and AI prompts. Default `DTC Portal`. |
| `LANDING_HOSTS` | no | Hostnames the landing-page review may fetch. Empty disables that review. |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | yes | Redis storage. |
| `BLOB_READ_WRITE_TOKEN` or `BLOB_STORE_ID` | no | Private Vercel Blob for archived ad media. |
| `CRON_SECRET` | for crons | Bearer secret Vercel sends to cron routes. |
| `VERCEL_ENV` | auto | Set by Vercel. Email sending and library seeding only run in `production`. |

**Meta**

| Variable | Required | Purpose |
|---|---|---|
| `META_AD_ACCOUNT_ID` | yes | Numeric id, no `act_` prefix. |
| `META_ACCESS_TOKEN` | yes | Token with `ads_read`. |
| `META_API_VERSION` | no | Graph API version (e.g. `v25.0`). |
| `META_PIXEL_ID` | no | Defaults to the first pixel of the account. |
| `META_SYSTEM_USER_TOKEN` | no | Enables Event Match Quality. |
| `META_TOKEN_EXPIRES_AT` | no | `YYYY-MM-DD` or `never`; drives the renewal banner. |
| `PIXEL_STATS_ENABLED` | no | `false` skips pixel stats (shared pixels). |
| `INSTAGRAM_ACCESS_TOKEN`, `INSTAGRAM_USER_ID`, `INSTAGRAM_USERNAME` | for Redes | Instagram Graph credentials. All three are required together. |
| `TARGET_CPA`, `TARGET_ROAS` | no | Targets used by alerts and the analyst. |

**AI analyst**

| Variable | Purpose |
|---|---|
| `AGENT_ENABLED` | `true` enables the daily agent job and chat. |
| `AGENT_PROVIDER` | `gemini` (default) or `anthropic`. An unknown value fails closed. |
| `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_FALLBACK_MODELS`, `GEMINI_FALLBACK_MODEL` | Gemini key, model and ordered fallbacks. |
| `ANTHROPIC_API_KEY`, `AGENT_MODEL` | Anthropic key and model (used when the provider is `anthropic`). |
| `AGENT_EMAIL_ENABLED` | `true` emails the daily recommendations to the allowlist. |

**Creative intelligence**

| Variable | Purpose |
|---|---|
| `INSPIRATION_ENABLED` | `true` enables the module. |
| `SCRAPECREATORS_API_KEY` | Ad Library access through ScrapeCreators (paid credits). |
| `INSPIRATION_CALL_LIMIT` | Lifetime cap on provider calls. Default `60`. |
| `INSPIRATION_BUDGET_MODE` | `provider` uses the real prepaid balance instead of the local cap. |
| `INSPIRATION_AI_ENABLED` | `true` enables Gemini analysis and plans (needs `GEMINI_API_KEY`). |
| `INSPIRATION_AUTO_ENABLED` | `true` lets the daily cron follow `auto:true` brands. |
| `INSPIRATION_PREVIEW` | Internal flag that marks the library read-only. Leave empty. |

**Email reports**

| Variable | Purpose |
|---|---|
| `RESEND_API_KEY`, `REPORT_FROM` | Resend credentials and verified sender. Also used for sign-in emails. |
| `REPORT_RECIPIENTS` | Recipients of the sales report. |
| `REPORT_SOCIAL_RECIPIENTS` | Extra recipients of the social report. |
| `REPORT_SECRET` | Bearer secret for `POST /api/report`. |
| `REPORT_ENABLED` | `true` allows sending (production only). |
| `AUTOMATION_ENABLED`, `SOCIAL_ENABLED` | Turn on the scheduled report crons. |
| `REPORT_START_DATE`, `SOCIAL_START_DATE` | First delivery date. Sales repeat every 3 days, social every 7. |

**Local MCP bridge**: `DTC_PORTAL_MCP_URL`, `DTC_PORTAL_MCP_TOKEN`, `DTC_MCP_TEST`. Also `VERCEL_SUPPORT_LARGE_FUNCTIONS=1` for packaging the Whisper model.

---

## Cron jobs

Defined in [`vercel.json`](vercel.json). All are protected by `CRON_SECRET` and run daily (UTC).

| Time | Path | What it does |
|---|---|---|
| 10:00 | `/api/dash-cron?job=snapshot` | Stores the daily data snapshot that the UI and the agent read. |
| 13:00 | `/api/dash-cron?job=agent` | Runs the AI analyst: recommendations, journal, optional email digest. Needs `AGENT_ENABLED`. |
| 15:00 | `/api/inspiration-cron` | Refreshes competitor brands flagged `auto:true`. Needs `INSPIRATION_AUTO_ENABLED`. |
| 16:00 | `/api/cron` | Scheduled sales email report with PDF. Needs `AUTOMATION_ENABLED`, `REPORT_START_DATE`. |
| 19:00 | `/api/social-cron` | Scheduled social email report. Also needs `SOCIAL_ENABLED`. |

---

## MCP server (Claude Code, Codex)

The portal exposes a **read-only** [MCP](https://modelcontextprotocol.io) endpoint at `https://<your-domain>/api/mcp` (Streamable HTTP, Bearer key). It offers 11 tools: sales, campaigns, creatives, pixel, social, alerts, status, journal, memory, saved inspiration, and a stored inspiration analysis. It cannot change campaigns or send messages.

Quick setup (details in [docs/mcp.md](docs/mcp.md)):

1. Sign in, open **Conectores**, create a personal key (shown once; valid 90 days; max 10 active per person; 120 requests/min per key).
2. On your machine, from this repo:

```sh
npm run mcp:configure   # asks for the portal URL and the key (hidden), saves to .data/ with 0600 permissions
npm run mcp:install     # registers the "dtc-portal" server in Codex and Claude Code via their CLIs
npm run mcp:check       # real end-to-end check
```

Removing an email from the allowlist revokes its keys.

---

## Chrome extension: Ad Saver

`chrome-extension/` adds a **Guardar en el portal** button to every ad in the Meta Ad Library. Clicking it opens your portal with the ad pre-filled so you can pick a board.

1. Edit `chrome-extension/config.js` and set `AD_SAVER_PORTAL_URL` to your deployment.
2. Open `chrome://extensions`, enable Developer mode, **Load unpacked**, select the `chrome-extension` folder.

It only runs on `facebook.com/ads/library` and stores no credentials. (Instructions inside the extension are in Spanish, like the UI.)

---

## Scope and limits

Honest list of what this is **not**:

- **No global ad library.** It only knows the brands you add and the pages it has fetched. Coverage depends on provider credits and pagination, and the UI labels partial coverage as partial.
- **No history before you start tracking**, no proprietary models trained on other advertisers' spend, no TikTok/LinkedIn connectors, no image/video generation and no automatic campaign launching.
- **Meta Ads only** for performance. Sales and funnel numbers come from Meta insights and the pixel. There is **no Shopify or other store integration**.
- **Single ad account, MXN, `America/Mexico_City`.** The Meta collector rejects accounts with another currency or time zone, and formatting, report windows and prompts assume them. Supporting other markets means editing `lib/meta.js`, `lib/meta-client.js`, `lib/dates.js` and the formatters in `public/app/format.js`.
- **Spanish UI and prompts.** Copy is hard-coded in Spanish; there is no i18n layer.
- **Topic detection is keyword-based** and tuned for consumer-wellness ads (`public/app/views/market-data.js`); edit the `themes` list for your category.
- **AI output is advice, not truth.** The analyst only recommends and cannot change anything in Meta. Gemini/Claude results need human review.
- **Archive budget is finite** (256 MB cumulative) and the ScrapeCreators API costs money; the portal never buys credits for you.
- Vercel function duration (`maxDuration: 300`) must be allowed by your Vercel plan.

---

## Third-party licenses

| Component | License | Where |
|---|---|---|
| claude-ads skill pack (condensed Meta guidance used by the AI analyst) | MIT, Copyright (c) 2026 agricidaniel. MIT allows redistribution with the notice kept. | `lib/agent/skills/LICENSE-claude-ads.txt` |
| Chart.js 4.5.1 | MIT | `public/app/vendor/LICENSE.chartjs.txt` |
| Montserrat font | SIL Open Font License 1.1 | `public/app/fonts/OFL.txt` |

npm and Python dependencies keep their own licenses (see `package-lock.json`, `requirements.txt`).

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Short version: keep `npm test` green, keep UI copy in Spanish, never commit secrets or real ad data.

## License

[MIT](LICENSE) © 2026 Mauricio Cervera.
