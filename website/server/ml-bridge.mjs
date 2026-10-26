import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { AiError } from './llm-client.mjs';

export async function createMlBridge({
  createClient,
  python = process.env.ML_PYTHON_EXE ||
    process.env.PYTHON_EXE ||
    (process.platform === 'win32' ? 'python' : 'python3'),
  timeoutMs = 210000,
  spawnWorker = spawn,
} = {}) {
  const directory = fileURLToPath(new URL('../ml/', import.meta.url));
  const extractor = process.env.ML_EXTRACT_MODEL || 'google/gemma-4-26b-a4b-it';
  const generator = process.env.LLM_MODEL || 'deepseek/deepseek-v4.1-flash';
  const allowedModels = new Set([extractor, generator]);
  const clients = new Map();
  const hash = createHash('sha256').update(JSON.stringify([extractor, generator]));
  for (const name of (await readdir(new URL('../ml/src/', import.meta.url)))
    .filter((n) => n.endsWith('.py'))
    .sort())
    hash.update(name).update(await readFile(new URL('../ml/src/' + name, import.meta.url)));
  hash.update(await readFile(new URL('../ml/data/business_matrix.json', import.meta.url)));
  const version = hash.digest('hex');
  let child,
    active,
    ready = false,
    waiting = 0,
    queue = Promise.resolve();
  function fail(code = 'ML_UNAVAILABLE') {
    ready = false;
    const pending = active;
    active = null;
    if (pending) {
      clearTimeout(pending.timer);
      pending.reject(
        new AiError(code, 'ML-модуль недоступен. Проверьте Python и зависимости ML.', 503)
      );
    }
    const previous = child;
    child = null;
    previous?.kill();
  }
  function start() {
    if (child) return;
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([name]) =>
          !/KEY|TOKEN|PASSWORD|SECRET/i.test(name) &&
          !['AUTH_USERS_FILE', 'PROFILES_FILE', 'DATASET_DIR'].includes(name)
      )
    );
    child = spawnWorker(python, ['-X', 'utf8', '-m', 'src.worker'], {
      cwd: directory,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...env,
        PYTHONUNBUFFERED: '1',
        PYTHONDONTWRITEBYTECODE: '1',
        PYTHONUTF8: '1',
        ML_NODE_TRANSPORT: '1',
        APP_DATA_DIR: process.env.APP_DATA_DIR || join(homedir(), '.alfa-business', 'runtime'),
        ML_EXTRACT_MODEL: extractor,
        LLM_MODEL: generator,
      },
    });
    const current = child;
    current.stderr.on('data', () => {}); // Third-party logs never become browser responses.
    const output = createInterface({ input: current.stdout });
    output.on('line', async (line) => {
      if (child !== current || !active) return;
      if (line.length > 1_000_000) return fail('ML_PROTOCOL_ERROR');
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        return fail('ML_PROTOCOL_ERROR');
      }
      const request = active;
      if (message.type === 'model') {
        if (
          !allowedModels.has(message.model) ||
          typeof message.id !== 'string' ||
          typeof message.system !== 'string' ||
          message.system.length > 60000 ||
          JSON.stringify(message.data).length > 250000 ||
          !Number.isInteger(message.maxTokens) ||
          message.maxTokens < 100 ||
          message.maxTokens > 6000
        )
          return fail('ML_PROTOCOL_ERROR');
        try {
          if (!clients.has(message.model)) clients.set(message.model, createClient(message.model));
          const call = await clients
            .get(message.model)
            .complete(message.system, message.data, { maxTokens: message.maxTokens });
          request.calls.push({
            stage: 'ml_model',
            tool: message.model,
            status: 'completed',
            durationMs: call.durationMs,
            ...call.usage,
          });
          if (child === current && active === request)
            current.stdin.write(
              JSON.stringify({ type: 'model_result', id: message.id, result: call.result }) + '\n'
            );
        } catch (error) {
          if (child === current && active === request)
            current.stdin.write(
              JSON.stringify({
                type: 'model_result',
                id: message.id,
                error: error.code || 'AI_PROVIDER_ERROR',
              }) + '\n'
            );
        }
      } else if (message.type === 'result' && message.id === request.id) {
        clearTimeout(request.timer);
        active = null;
        if (message.error) {
          const code = /^(ML_|AI_)[A-Z_]+$/.test(message.error)
            ? message.error
            : 'ML_PROCESSING_FAILED';
          request.reject(
            new AiError(code, 'ML не завершил разбор. Непроверенные выводы не показаны.', 502)
          );
        } else {
          ready = true;
          request.resolve({ ...message.result, modelCalls: request.calls });
        }
      } else fail('ML_PROTOCOL_ERROR');
    });
    current.on('error', () => {
      if (child === current) fail();
    });
    current.on('exit', () => {
      if (child === current) fail();
    });
  }
  function request(method, input) {
    if (waiting >= 4)
      return Promise.reject(
        new AiError('ML_BUSY', 'ML обрабатывает другие запросы. Повторите позже.', 429)
      );
    waiting++;
    const operation = queue
      .then(
        () =>
          new Promise((resolve, reject) => {
            start();
            const id = randomUUID();
            active = {
              id,
              resolve,
              reject,
              calls: [],
              timer: setTimeout(() => fail('ML_TIMEOUT'), timeoutMs),
            };
            child.stdin.write(JSON.stringify({ id, method, input }) + '\n', (error) => {
              if (error) fail();
            });
          })
      )
      .finally(() => waiting--);
    queue = operation.catch(() => {});
    return operation;
  }
  return {
    version,
    draft: (input) => request('analyze', input),
    health: () => request('health'),
    status: () => ({
      enabled: true,
      ready,
      version,
      transport: 'local-process',
      extractor,
      generator,
    }),
    close: () => fail(),
  };
}
