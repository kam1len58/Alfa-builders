import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createInterface } from 'node:readline';
import { createMlBridge } from '../server/ml-bridge.mjs';

test('ML subprocess receives no credentials; model calls use the metered parent and preserve request identity', async () => {
  let environment,
    requests = 0,
    calls = 0;
  const old = process.env.LLM_API_KEY;
  process.env.LLM_API_KEY = 'synthetic-secret-must-not-leave-node';
  const bridge = await createMlBridge({
    createClient: (model) => ({
      complete: async () => {
        calls++;
        assert.equal(model, 'deepseek/deepseek-v4.1-flash');
        return {
          result: { summary: 'checked' },
          usage: { inputTokens: 2, outputTokens: 3 },
          durationMs: 4,
        };
      },
    }),
    spawnWorker: (_python, _args, options) => {
      environment = options.env;
      const child = new EventEmitter();
      child.stdin = new PassThrough();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.kill = () => child.emit('exit', 0);
      let current;
      createInterface({ input: child.stdin }).on('line', (line) => {
        const message = JSON.parse(line);
        if (message.type === 'model_result') {
          assert.equal(message.id, 'call-' + current.id);
          child.stdout.write(
            JSON.stringify({
              type: 'result',
              id: current.id,
              result: { analysis: message.result },
            }) + '\n'
          );
        } else {
          requests++;
          current = message;
          child.stdout.write(
            JSON.stringify({
              type: 'model',
              id: 'call-' + message.id,
              model: 'deepseek/deepseek-v4.1-flash',
              system: 'safe',
              data: {},
              maxTokens: 500,
            }) + '\n'
          );
        }
      });
      return child;
    },
  });
  try {
    const values = await Promise.all([bridge.draft({}), bridge.draft({})]);
    assert.equal(environment.LLM_API_KEY, undefined);
    assert.equal(environment.ML_NODE_TRANSPORT, '1');
    assert.equal(requests, 2);
    assert.equal(calls, 2);
    assert.ok(values.every((v) => v.analysis.summary === 'checked' && v.modelCalls.length === 1));
    assert.equal(bridge.status().ready, true);
  } finally {
    bridge.close();
    if (old === undefined) delete process.env.LLM_API_KEY;
    else process.env.LLM_API_KEY = old;
  }
});

test('A crashed ML subprocess fails explicitly instead of returning a prepared AI answer', async () => {
  const bridge = await createMlBridge({
    createClient: () => {
      throw new Error('Unexpected model call');
    },
    spawnWorker: () => {
      const child = new EventEmitter();
      child.stdin = new PassThrough();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.kill = () => {};
      setImmediate(() => child.emit('exit', 1));
      return child;
    },
  });
  await assert.rejects(bridge.draft({}), (e) => e.code === 'ML_UNAVAILABLE');
  assert.equal(bridge.status().ready, false);
  bridge.close();
});
