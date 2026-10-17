import { createApp } from './app.js';
import { loadConfig } from './config.js';

let config;
try {
  config = loadConfig(process.env);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

createApp(config).listen(config.port, () => {
  console.log(
    `mock-erp on :${config.port} (failure=${config.failureRate}, slow=${config.slowRate}, ` +
      `rateLimit=${config.rateLimitRate}, slowMs=${config.slowMs})`,
  );
});
