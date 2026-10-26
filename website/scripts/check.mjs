import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
let count = 0;
for (const folder of ['server', 'dist', 'scripts', 'test']) {
  for (const name of await readdir(new URL('../' + folder + '/', import.meta.url))) {
    if (!/\.(mjs|js)$/.test(name)) continue;
    const result = spawnSync(process.execPath, ['--check', folder + '/' + name], {
      cwd: root,
      stdio: 'inherit',
      windowsHide: true,
    });
    if (result.status !== 0) process.exit(result.status || 1);
    count++;
  }
}
const entry = spawnSync(process.execPath, ['--check', 'server.mjs'], {
  cwd: root,
  stdio: 'inherit',
  windowsHide: true,
});
if (entry.status !== 0) process.exit(1);
console.log('Проверен синтаксис ' + (count + 1) + ' файлов JavaScript.');
