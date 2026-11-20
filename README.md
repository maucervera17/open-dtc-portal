# Open DTC Portal

An open-source, self-hosted portal for a direct-to-consumer (DTC) brand. It does two jobs in one place:

1. **Measure your own campaigns**: Meta Ads performance, sales, pixel health, Instagram, alerts, and an AI analyst with memory and a daily journal.
2. **Study the competition**: a creative-intelligence module that tracks competitor ads from the Meta Ad Library (radar, saved library, AI analysis, daily production plan).

It is an open, self-hosted alternative inspired by tools such as Atria. It is not affiliated with, endorsed by, or derived from any of them.

> **The UI is in Spanish** (es-MX). Currency and time zone are not fixed: the portal uses the ones of your Meta ad account. See [Currency and time zone](#currency-and-time-zone).

---

## Try the demo

Click through every screen with fictional data. No accounts, API keys or network access are needed:

```sh
npm install
npm run demo
```

Then open <http://127.0.0.1:3060/app/>. You are signed in automatically as `demo@example.com`. Set `PORT` to use another port (`PORT=3061 npm run demo`). Press Ctrl+C to stop.

- **What you get:** a made-up brand, "Example Co.", with 60 days of campaigns, creatives, pixel events, Instagram, alerts, a weekly journal, an analyst chat, and the competitor radar, saved library and daily plan (all with placeholder images). A small "Demo mode — fictional data" badge marks every page.
- **How it works:** a plain Node server (`demo/`) serves `public/` with the rewrites from `vercel.json` and runs the portal's real `/api` handlers against an in-memory store and fake Meta, Instagram, ScrapeCreators, Resend and Gemini APIs. The portal's collectors, validators and views run unchanged; the data is generated deterministically in `demo/world.js`.
- **AI answers are canned.** The chat, analysis and plan are written by rules, not by a model, and say so.
- **Safe by construction:** the server only listens on `127.0.0.1`, builds its own configuration (your environment is never read), refuses every outbound network call, and the auto sign-in lives only in the demo entry script: nothing under `api/` or `lib/` imports it, so a deployment can never expose it.
- Everything resets when you stop the server. The fictional account is **USD** and **America/New_York** by default (the fake Graph API reports them, like a real account would; `startDemo({ profile })` accepts any valid ISO currency and IANA zone). Ad previews are unavailable because there is no real Facebook ad to show.

---

## Contents

- [Try the demo](#try-the-demo)
- [Feature tour](#feature-tour)
- [Architecture](#architecture)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [Cron jobs](#cron-jobs)
- [MCP server (Claude Code, Codex)](#mcp-server-claude-code-codex)
- [Chrome extension: Ad Saver](#chrome-extension-ad-saver)
- [Currency and time zone](#currency-and-time-zone)
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

**Requirements:** Node 22, a Meta ad account (any currency and time zone) with an access token, an Upstash Redis database, and a Resend account for sign-in emails.

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
| `TARGET_CPA`, `TARGET_ROAS` | no | Targets used by alerts and the analyst. `TARGET_CPA` is an amount in the ad account currency; `TARGET_ROAS` is a ratio. |
| `REPORT_CURRENCY` | no | ISO 4217 code (e.g. `USD`, `EUR`, `JPY`). Overrides the currency of the ad account. **Only relabels amounts, it never converts them**: leave empty unless you know why. An invalid code is a configuration error. |
| `REPORT_TIMEZONE` | no | IANA time zone (e.g. `America/New_York`). Overrides the time zone of the ad account for "today", "yesterday", report windows and cron day boundaries. Meta still cuts its own insight days in the account's zone. An invalid name is a configuration error. |
| `MIN_SPEND` | no | Minimum spend (account currency, per 7-day window) before an ad can be judged for fatigue or a STOP/SCALE call. Default: about USD 15 in your currency (see below). |

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

Defined in [`vercel.json`](vercel.json). All are protected by `CRON_SECRET` and run daily. **Vercel cron schedules are always UTC**, so the times below are UTC. Only the *schedule* is UTC: every job works on the calendar day of the account's time zone (DST included), so a run that fires at 10:00 UTC still reports the right local day. Move the `schedule` entries in `vercel.json` if you want the emails to land at a convenient local hour (for example `0 16 * * *` is 11:00 in New York in winter and 12:00 in summer; adjust twice a year if the exact local hour matters).

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

## Currency and time zone

Nothing is hard-coded to one market. The **Meta ad account's own `currency` and `timezone_name`** (read from the Graph API) are the source of truth.

- **Resolution order:** `REPORT_CURRENCY` / `REPORT_TIMEZONE` (if set and valid) > what the ad account reports > a UTC / USD fallback used only until the account has been read once. The result is remembered in Redis (`dtc:dash:profile:<account>`) and the account is re-read at most once an hour by signed-in requests and crons, so a change of currency or time zone is picked up (and warned about) rather than masked. If the account cannot be read and nothing is stored, crons and reports stop without advancing their cursors instead of guessing UTC and the browser receives it in `GET /api/dash/me` (`profile.currency`, `profile.timezone`) and in the status payload. Money payloads carry `currency` and `timezone`.
- **Money** is formatted with `Intl.NumberFormat` in the resolved currency, with that currency's own minor units (JPY has no decimals, KWD has three) in the UI, PDFs, emails, MCP outputs, AI facts and prompts. The text locale stays Spanish (`es-MX`), so number grouping is `1,234.50`. PDFs use a standard font: when a currency symbol cannot be drawn (for example the rupee), the ISO code is printed instead.
- **Days.** "Today", "yesterday", "last N days", the completed-days check of `/api/report`, the cron day boundaries, the pixel and Instagram day buckets and the browser's date pickers all use the resolved time zone. Dates are plain calendar dates (`YYYY-MM-DD`) and day boundaries come from the platform tz database, so daylight-saving changes (23 and 25 hour days) are handled.
- **Account changes.** If the ad account's currency or time zone differs from what was stored, the portal records a warning (kept 400 days, as long as the snapshots that mix the two units), shows a banner in the app, and adds a note to the next PDF. It never silently mixes units.
- **Money-sized thresholds** do not assume one currency. The fatigue/analyst sample gate (`MIN_SPEND`) defaults to roughly USD 15 expressed in your currency, from a small rough rate table in `lib/locale.js` (USD 15, EUR about 14, JPY 2,250, a peso-sized currency about 300); set `MIN_SPEND` to be exact. The analyst's "minimum spend to stop" is already relative (2 x your target CPA, else 2 x the account CPA). The Analíticas evidence levels scale with the same USD 10 unit. `TARGET_CPA` is in your currency.
- **Competitor CPM estimates** (Inspiración) are explicitly in USD: they are an assumed market CPM, not your account.
- `REPORT_CURRENCY` does **not convert**. Meta reports spend in the account currency; the override only changes the label and formatting.

## Scope and limits

Honest list of what this is **not**:

- **No global ad library.** It only knows the brands you add and the pages it has fetched. Coverage depends on provider credits and pagination, and the UI labels partial coverage as partial.
- **No history before you start tracking**, no proprietary models trained on other advertisers' spend, no TikTok/LinkedIn connectors, no image/video generation and no automatic campaign launching.
- **Meta Ads only** for performance. Sales and funnel numbers come from Meta insights and the pixel. There is **no Shopify or other store integration**.
- **Single ad account, one currency and one time zone.** Any currency and time zone work, but a deployment follows exactly one account. Amounts are never converted between currencies (see [Currency and time zone](#currency-and-time-zone)).
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
