import { spawn, spawnSync } from 'node:child_process';
import { access, mkdir, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { buildProfiles } from './build-profiles.mjs';
const site = fileURLToPath(new URL('../', import.meta.url));
try {
  process.loadEnvFile(join(site, '.env.local'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const runtime = resolve(process.env.APP_DATA_DIR || join(homedir(), '.alfa-business', 'runtime'));
buildProfiles();
const backend = resolve(process.env.BACKEND_PATH || join(site, '../../Alfa-builders-backend'));
const project = join(backend, 'NewsAnalytics/NewsAnalytics/NewsAnalytics.API.csproj');
await access(project);
const schema = await readFile(join(backend, 'NewsAnalytics/NewsAnalytics.Models/NewsItem.cs'));
const schemaId = createHash('sha256').update(schema).digest('hex').slice(0, 12);
const database = join(runtime, 'backend-' + schemaId);
await mkdir(database, { recursive: true });
const apiPort = Number(process.env.BACKEND_PORT || 5194);
const backendUrl = 'http://127.0.0.1:' + apiPort;
let dotnet = process.env.DOTNET_EXE || 'dotnet';
if (process.platform === 'win32' && spawnSync(dotnet, ['--version'], { windowsHide: true }).error)
  dotnet = join(process.env.ProgramFiles || 'C:/Program Files', 'dotnet/dotnet.exe');
const children = [];
function stop() {
  for (const child of children) child.kill();
}
process.on('SIGINT', () => {
  stop();
  process.exit(0);
});
process.on('SIGTERM', () => {
  stop();
  process.exit(0);
});
async function available() {
  try {
    const response = await fetch(backendUrl + '/api/Companies', {
      signal: AbortSignal.timeout(1000),
    });
    const rows = await response.json();
    return response.ok && Array.isArray(rows) && rows.every((r) => r.syntheticU);
  } catch {
    return false;
  }
}
if (!(await available())) {
  console.log(
    'Сборка API. Для демонстрационных данных используется отдельная база по версии схемы; старые базы сохраняются.'
  );
  const build = spawnSync(
    dotnet,
    ['build', project, '-c', 'Release', '--nologo', '-v', 'minimal'],
    { stdio: 'inherit', windowsHide: true }
  );
  if (build.status !== 0) process.exit(build.status || 1);
  const dll = join(
    backend,
    'NewsAnalytics/NewsAnalytics/bin/Release/net10.0/NewsAnalytics.API.dll'
  );
  const api = spawn(
    dotnet,
    [dll, '--contentRoot', join(backend, 'NewsAnalytics/NewsAnalytics'), '--urls', backendUrl],
    {
      cwd: database,
      env: {
        ...process.env,
        ASPNETCORE_ENVIRONMENT: 'Production',
        Logging__LogLevel__Default: 'Warning',
      },
      stdio: 'inherit',
      windowsHide: true,
    }
  );
  children.push(api);
  let ready = false;
  for (let i = 0; i < 30; i++) {
    if (await available()) {
      ready = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!ready) {
    stop();
    throw new Error('API не запустился. Проверьте журнал выше.');
  }
} else console.log('Используется работающий локальный API: ' + backendUrl);
const web = spawn(process.execPath, [join(site, 'server.mjs')], {
  cwd: site,
  env: { ...process.env, BACKEND_URL: backendUrl, APP_DATA_DIR: runtime },
  stdio: 'inherit',
  windowsHide: true,
});
children.push(web);
web.on('exit', (code) => {
  stop();
  process.exit(code || 0);
});
