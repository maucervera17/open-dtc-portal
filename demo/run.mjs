// `npm run demo`: local demo with fictional data. PORT overrides the default port (3060). Binds to 127.0.0.1 only.
import { startDemo, DEFAULT_PORT } from './start.js';

const requested = process.env.PORT === undefined || process.env.PORT === '' ? DEFAULT_PORT : Number(process.env.PORT);
if (!Number.isInteger(requested) || requested < 0 || requested > 65535) {
  console.error(`Invalid PORT: ${process.env.PORT}`);
  process.exit(1);
}

try {
  const demo = await startDemo({ port: requested, log: message => console.log(message) });
  console.log(`\nOpen DTC Portal demo is running (fictional data, no external services).\n\n  ${demo.url}/app/\n\nYou are signed in automatically as demo@example.com. Press Ctrl+C to stop.`);
  const shutdown = async () => { await demo.stop(); process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
} catch (error) {
  if (error?.code === 'EADDRINUSE') console.error(`Port ${requested} is already in use. Try: PORT=3061 npm run demo`);
  else console.error(error);
  process.exit(1);
}
