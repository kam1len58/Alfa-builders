import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadProfiles } from '../server/profiles.mjs';
import { createDataService } from '../server/data-service.mjs';

test('CSV-каталог подключает новую компанию и ранжирует новости без записи в C#', async () => {
  const root = await mkdtemp(join(tmpdir(), 'alfa-profiles-'));
  try {
    const profile = {
      syntheticU: 'U_100',
      okvedCode: '49.41',
      bankProducts: {},
      counterparties: {},
      affiliation: {},
      industryPosition: {},
      ved: {},
    };
    const path = join(root, 'profiles.json');
    await writeFile(path, JSON.stringify({ schemaVersion: 1, profiles: [profile] }));
    const profiles = await loadProfiles(path);
    const service = createDataService({
      profiles,
      collector: { news: () => [] },
      backendUrl: 'http://127.0.0.1',
      fetcher: async (url) =>
        url.pathname === '/api/News'
          ? {
              ok: true,
              json: async () => [
                {
                  id: 'new',
                  title: 'Дизель подорожал',
                  content: 'Стоимость дизельного топлива выросла.',
                  publishedAt: '2026-10-01',
                },
              ],
            }
          : { status: 404, ok: false },
    });
    assert.equal((await service.companies()).length, 1);
    assert.equal((await service.company('U_100')).syntheticU, 'U_100');
    const [row] = await service.feed('U_100');
    assert.equal(row.score, 0.85);
    assert.equal(row.rankingOrigin, 'source-rules-v3');
    await writeFile(path, JSON.stringify({ schemaVersion: 1, profiles: [profile, profile] }));
    await assert.rejects(loadProfiles(path), /Invalid/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
