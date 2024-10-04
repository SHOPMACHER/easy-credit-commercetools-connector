import * as dotenv from 'dotenv';
dotenv.config();

import { readConfiguration } from './utils/config.utils';

import { setupFastify } from './server/server';

// Read env variables
readConfiguration();

(async () => {
  const server = await setupFastify();

  const HOST = '0.0.0.0';
  try {
    await server.listen({
      port: 8188,
      host: HOST,
    });
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
})();
