import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { safeFetch } from '../server/safe-fetch.mjs';
const resolver = async () => [{ address: '93.184.216.34', family: 4 }];
function requester(mode) {
  return (_url, _options, callback) => {
    const request = new EventEmitter();
    request.destroy = () => {};
    request.end = () =>
      queueMicrotask(() => {
        const response = new EventEmitter();
        response.headers = {};
        response.statusCode = 200;
        response.complete = false;
        response.destroy = () => response.emit('close');
        callback(response);
        if (mode === 'large') response.emit('data', Buffer.alloc(100));
        else if (mode === 'aborted') response.emit('aborted');
        else if (mode === 'ok') {
          response.emit('data', Buffer.from('ok'));
          response.complete = true;
          response.emit('end');
        }
        request.emit('close');
      });
    return request;
  };
}
test('Загрузка ограничена по размеру и времени даже при раннем закрытии request и обрыве response', async () => {
  const options = { allowedHosts: ['example.com'], maxBytes: 10, timeoutMs: 30, resolver };
  for (const [mode, code] of [
    ['large', 'SOURCE_TOO_LARGE'],
    ['aborted', 'SOURCE_INCOMPLETE'],
    ['stall', 'SOURCE_TIMEOUT'],
  ])
    await assert.rejects(
      safeFetch('https://example.com', { ...options, requester: requester(mode) }),
      new RegExp(code)
    );
  assert.equal(
    (
      await safeFetch('https://example.com', { ...options, requester: requester('ok') })
    ).bytes.toString(),
    'ok'
  );
});
