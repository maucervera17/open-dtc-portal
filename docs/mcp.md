# MCP setup

The portal exposes a read-only MCP server so Claude Code, Codex or Claude Desktop can query your data.

- Endpoint: `https://<your-domain>/api/mcp` (Streamable HTTP, `Authorization: Bearer <key>`).
- Tools (all read-only): `get_sales`, `list_campaigns`, `list_creatives`, `get_pixel`, `get_social`, `get_alerts`, `get_status`, `get_journal`, `get_memory`, `list_inspiration`, `get_inspiration_analysis`.
- Keys: created in the app under **Conectores**, shown once, stored only as an HMAC in Redis, valid 90 days, max 10 active per person, 120 requests per minute per key. They stop working when the email leaves the allowlist.

## Claude Code and Codex (stdio bridge)

```sh
npm run mcp:configure   # prompts for the portal URL and the key (hidden input)
npm run mcp:install     # runs `codex mcp add` and `claude mcp add` for "dtc-portal"
npm run mcp:check       # lists tools and calls get_status from the installed config
```

The key is stored in `.data/mcp-credentials.json` (mode 0600, git-ignored). The bridge only sends it to the HTTPS endpoint you configured, with redirects disabled. Open a new assistant session afterwards so the tools load.

## Claude Desktop

Register the same bridge as a stdio server, using `node` and the absolute path to `scripts/portal-mcp-bridge.mjs`.

## Environment overrides

`DTC_PORTAL_MCP_URL` and `DTC_PORTAL_MCP_TOKEN` override the stored credentials (useful in CI). `DTC_MCP_TEST=1` additionally allows `http://127.0.0.1` for local testing.
