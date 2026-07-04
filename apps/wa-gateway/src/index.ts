import { loadConfig } from './config.js';
import { OpenWaClient } from './openwa.js';
import { buildServer } from './server.js';

const config = loadConfig();
const openwa = new OpenWaClient({
  baseUrl: config.OPENWA_API_URL,
  ...(config.OPENWA_API_KEY ? { apiKey: config.OPENWA_API_KEY } : {}),
});

const app = buildServer({
  openwa,
  orchestratorBaseUrl: config.ORCHESTRATOR_BASE_URL,
  sharedSecret: config.INTERNAL_SHARED_SECRET,
});

app
  .listen({ port: config.PORT, host: '0.0.0.0' })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
