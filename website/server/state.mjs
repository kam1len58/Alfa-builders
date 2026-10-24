import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';

export async function openState(
  directory = process.env.APP_DATA_DIR || join(homedir(), '.alfa-business', 'runtime')
) {
  const root = resolve(directory);
  await mkdir(root, { recursive: true });
  const path = join(root, 'service.json');
  let data = {
    version: 1,
    documents: [],
    sources: {},
    feedback: [],
    analyses: [],
    reviews: [],
    audit: [],
    evaluation: null,
  };
  try {
    data = JSON.parse(await readFile(path, 'utf8'));
    if (data.version !== 1 || !Array.isArray(data.documents) || !Array.isArray(data.audit))
      throw new Error('Invalid state version');
  } catch (error) {
    if (error.code !== 'ENOENT')
      throw new Error(
        'Хранилище повреждено или недоступно. Восстановите резервную копию service.json.'
      );
  }
  let queue = Promise.resolve();
  const snapshot = () => structuredClone(data);
  function update(change) {
    const operation = queue.then(async () => {
      const next = structuredClone(data);
      const result = await change(next);
      const temporary = path + '.' + randomUUID() + '.tmp';
      await writeFile(temporary, JSON.stringify(next), { encoding: 'utf8', mode: 0o600 });
      await rename(temporary, path);
      data = next;
      return result;
    });
    queue = operation.catch(() => {});
    return operation;
  }
  async function audit(entry) {
    // Только технические метаданные. Тексты источников, вопросы и секреты сюда не передаются.
    const fields = [
      'actor',
      'operation',
      'companyId',
      'newsId',
      'analysisId',
      'tool',
      'status',
      'code',
      'durationMs',
      'count',
    ];
    await update((state) => {
      state.audit.push({
        at: new Date().toISOString(),
        ...Object.fromEntries(
          fields.filter((k) => entry[k] !== undefined).map((k) => [k, entry[k]])
        ),
      });
      state.audit = state.audit.slice(-2000);
    });
  }
  return { snapshot, update, audit, root };
}
