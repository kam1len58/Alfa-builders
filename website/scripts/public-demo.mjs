import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startDemoBackend } from '../server/public-demo.mjs';
// A public demo must never inherit private runtime, account files, CSV profiles or model keys.
for (const key of [
  'AUTH_USERS_FILE',
  'PROFILES_FILE',
  'DATASET_DIR',
  'LLM_API_KEY',
  'LLM_CACHE_DIR',
  'LLM_AUDIT_PATH',
])
  delete process.env[key];
process.env.PUBLIC_DEMO = '1';
process.env.APP_DATA_DIR = join(tmpdir(), 'alfa-public-demo-' + (process.env.PORT || 4173));
process.env.APP_BIND_ADDRESS = process.env.APP_BIND_ADDRESS || '0.0.0.0';
process.env.SOURCE_REFRESH_MINUTES = '0';
const backend = await startDemoBackend();
process.env.BACKEND_URL = backend.url;
await import('../server/application.mjs');
