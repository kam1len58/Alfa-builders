import { readFile, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { passwordHash } from '../server/access.mjs';
const [output, id, role = 'analyst', companies = '*'] = process.argv.slice(2);
if (!output || !id || !['owner', 'editor', 'analyst', 'expert', 'viewer'].includes(role))
  throw new Error(
    'Использование: node scripts/create-access.mjs <файл вне Git> <логин> <роль> <компании через запятую>. Пароль передайте через ALFA_NEW_PASSWORD.'
  );
const password = process.env.ALFA_NEW_PASSWORD;
const repository = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const destination = resolve(output);
if (destination === repository || destination.startsWith(repository + sep))
  throw new Error('Файл аккаунтов должен находиться вне репозитория.');
if (!password || password.length < 12)
  throw new Error(
    'Задайте ALFA_NEW_PASSWORD длиной от 12 символов. Пароль не передаётся в аргументах.'
  );
let data = { users: [] };
try {
  data = JSON.parse(await readFile(resolve(output), 'utf8'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
if (data.users.some((user) => user.id === id))
  throw new Error('Пользователь уже существует; файл не изменён.');
data.users.push({
  id,
  name: id,
  role,
  companies: companies
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  passwordHash: passwordHash(password),
});
await writeFile(resolve(output), JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 });
console.log('Учётная запись добавлена. Пароль в файл не записан; хранится хеш scrypt.');
