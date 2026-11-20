import { readFile } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
let config = {};
try {
  config = JSON.parse(
    await readFile(
      new URL("../.data/mcp-credentials.json", import.meta.url),
      "utf8",
    ),
  );
} catch {}
const endpoint = process.env.DTC_PORTAL_MCP_URL || config.url;
if (!endpoint) {
  console.error("Falta la URL del portal. Ejecuta npm run mcp:configure.");
  process.exit(1);
}
const target = new URL(endpoint);
const loopbackTest = process.env.DTC_MCP_TEST === "1" && target.hostname === "127.0.0.1";
// The key is only ever sent to the one endpoint the user configured: HTTPS, no credentials in the URL.
if (target.username || target.password || target.search || target.hash ||
    !target.pathname.endsWith("/api/mcp") || (target.protocol !== "https:" && !loopbackTest)) {
  throw new Error("Endpoint MCP no autorizado.");
}
const secret = process.env.DTC_PORTAL_MCP_TOKEN || config.token;
if (!secret) {
  console.error(
    "Crea una clave en el portal → Conectores, y ejecuta npm run mcp:configure.",
  );
  process.exit(1);
}
const client = new Client({ name: "dtc-stdio-bridge", version: "1.0.0" });
await client.connect(
  new StreamableHTTPClientTransport(new URL(endpoint), {
    requestInit: { redirect: "error", headers: { Authorization: `Bearer ${secret}` } },
  }),
);
const server = new Server(
  { name: "dtc-portal", version: "1.0.0" },
  { capabilities: { tools: {} } },
);
server.setRequestHandler(ListToolsRequestSchema, () => client.listTools());
server.setRequestHandler(CallToolRequestSchema, (req) =>
  client.callTool(req.params),
);
await server.connect(new StdioServerTransport());
async function close() {
  await client.close();
  await server.close();
  process.exit(0);
}
process.on("SIGINT", close);
process.on("SIGTERM", close);
