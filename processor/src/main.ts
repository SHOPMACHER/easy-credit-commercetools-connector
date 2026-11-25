import 'dotenv/config';

import { setupFastify } from './server/server';
import { logConfigurationWarnings } from './services/connector.service';

logConfigurationWarnings();

(async () => {
  const server = await setupFastify();

  const HOST = '0.0.0.0';
  try {
    await server.listen({
      port: 8080,
      host: HOST,
    });
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
})();
