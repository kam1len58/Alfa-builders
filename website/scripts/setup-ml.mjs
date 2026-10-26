import { spawnSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
const site = fileURLToPath(new URL('../', import.meta.url));
try {
  process.loadEnvFile(join(site, '.env.local'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const runtime = resolve(process.env.APP_DATA_DIR || join(homedir(), '.alfa-business', 'runtime'));
const directory = join(runtime, 'ml', 'venv');
const python = process.env.PYTHON_EXE || (process.platform === 'win32' ? 'python' : 'python3');
function run(executable, args, env = process.env) {
  const result = spawnSync(executable, args, {
    cwd: site,
    env,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error || result.status !== 0)
    throw new Error(
      'Не удалось подготовить ML. Проверьте Python 3.12 и доступ к источникам зависимостей.'
    );
}
await mkdir(join(runtime, 'ml'), { recursive: true });
run(python, ['-m', 'venv', directory]);
const interpreter = join(
  directory,
  process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'
);
run(interpreter, ['-m', 'pip', 'install', '-r', join(site, 'ml', 'requirements.txt')]);
run(
  interpreter,
  [
    '-X',
    'utf8',
    '-c',
    'from src.rag import get_model; get_model(); print("Модель эмбеддингов готова")',
  ],
  {
    ...process.env,
    APP_DATA_DIR: runtime,
    PYTHONPATH: join(site, 'ml'),
    HF_HUB_DISABLE_TELEMETRY: '1',
  }
);
console.log('ML подготовлен. npm start использует это окружение автоматически.');
