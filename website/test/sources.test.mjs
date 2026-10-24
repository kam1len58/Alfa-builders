import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { parseFeed, parseArticle, normalizeDate } from '../server/source-parser.mjs';
import { isPublicAddress, assertSourceUrl } from '../server/safe-fetch.mjs';
import { openState } from '../server/state.mjs';
import { createCollector } from '../server/collector.mjs';
const feed = (description) =>
  '<?xml version="1.0"?><rss><channel><item><title>Инфляция &amp; спрос</title><link>https://www.cbr.ru/press/new?utm_source=test</link><pubDate>Fri, 23 Oct 2026 13:30:00 GMT</pubDate><description>' +
  description +
  '</description></item></channel></rss>';
test('RSS декодирует HTML и удаляет активные элементы; Atom сохраняет URL и дату', () => {
  const [item] = parseFeed(
    feed('&lt;p&gt;Цены &amp; спрос изменились.&lt;/p&gt;&lt;script&gt;alert(1)&lt;/script&gt;'),
    'https://www.cbr.ru/rss'
  );
  assert.equal(item.text, 'Цены & спрос изменились.');
  assert.equal(item.url, 'https://www.cbr.ru/press/new');
  const atom =
    '<feed><entry><title>Событие</title><link href="https://www.cbr.ru/a"/><updated>2026-10-01T00:00:00Z</updated><summary>Описание события</summary></entry></feed>';
  assert.equal(parseFeed(atom, 'https://www.cbr.ru/')[0].url, 'https://www.cbr.ru/a');
});
test('DTD, некорректный XML и будущие даты не принимаются', () => {
  assert.throws(() => parseFeed('<!DOCTYPE x [<!ENTITY e "x">]><rss/>', 'https://www.cbr.ru/'));
  assert.throws(() => parseFeed('<rss>', 'https://www.cbr.ru/'));
  assert.equal(normalizeDate('not date'), null);
  assert.equal(normalizeDate('2100-01-01'), null);
});
test('HTML извлекает только статью, дату и заголовок', () => {
  const item = parseArticle(
    '<html><head><meta property="article:published_time" content="2026-10-01"></head><body><nav>Мусор</nav><article><h1>Заголовок</h1><p>Текст новости</p><script>steal()</script></article></body></html>',
    'https://www.cbr.ru/x'
  );
  assert.equal(item.title, 'Заголовок');
  assert.ok(item.text.includes('Текст новости'));
  assert.ok(!item.text.includes('steal'));
  assert.ok(item.publishedAt);
});
test('SSRF: адрес, протокол, credentials и частные IPv4/IPv6 отклонены', () => {
  for (const address of [
    '127.0.0.1',
    '10.0.0.1',
    '169.254.169.254',
    '172.16.1.1',
    '192.168.1.1',
    '100.64.1.1',
    '::1',
    'fc00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
  ])
    assert.equal(isPublicAddress(address), false, address);
  assert.equal(isPublicAddress('8.8.8.8'), true);
  for (const url of [
    'http://www.cbr.ru/',
    'https://www.cbr.ru.evil.test/',
    'https://user:pass@www.cbr.ru/',
    'https://127.0.0.1/',
    'https://www.cbr.ru:444/',
  ])
    assert.throws(() => assertSourceUrl(url, ['www.cbr.ru']));
});
test('Коллектор: дедупликация, хеш скана, повторный импорт и отказ отдельного источника', async () => {
  const root = await mkdtemp(join(tmpdir(), 'alfa-collector-'));
  try {
    const store = await openState(join(root, 'state')),
      pdf = Buffer.from('%PDF-approved-scan');
    const digest = createHash('sha256').update(pdf).digest('hex');
    const config = {
      allowedHosts: ['www.cbr.ru', 'drive.google.com'],
      sources: [
        {
          id: 'news',
          kind: 'news',
          publisher: 'Тест',
          format: 'rss',
          url: 'https://www.cbr.ru/rss',
        },
        {
          id: 'bank',
          kind: 'bank',
          publisher: 'Банк',
          format: 'pdf',
          url: 'https://drive.google.com/file',
          excerptId: 'case',
        },
        { id: 'broken', kind: 'news', format: 'rss', url: 'https://www.cbr.ru/broken' },
      ],
    };
    await writeFile(join(root, 'sources.json'), JSON.stringify(config));
    await writeFile(
      join(root, 'excerpts.json'),
      JSON.stringify([
        {
          id: 'case',
          sha256: digest,
          title: 'Материал банка',
          publishedAt: '2026-09-01',
          documentUrl: 'https://drive.google.com/view',
          excerpts: [{ page: 1, text: 'Проверенный короткий фрагмент банка' }],
          topics: ['RATE'],
          caveat: 'Исторический материал',
        },
      ])
    );
    const download = async (url) => {
      if (url.includes('broken')) throw new Error('NETWORK_DOWN');
      return {
        status: 200,
        url,
        headers: {},
        bytes: url.includes('drive')
          ? pdf
          : Buffer.from(
              feed(
                '<![CDATA[<p>Инфляция замедлилась. Это достаточно длинное описание события, позволяющее проверить правильную классификацию и выделение текста новости.</p>]]>'
              )
            ),
      };
    };
    const collector = await createCollector({
      store,
      configPath: join(root, 'sources.json'),
      excerptsPath: join(root, 'excerpts.json'),
      download,
    });
    await collector.refresh({ force: true });
    await collector.refresh({ force: true });
    assert.equal(collector.news().length, 1);
    assert.equal(collector.documents().length, 2);
    assert.equal(collector.status().find((s) => s.id === 'broken').status, 'error');
    const bank = collector.documents().find((d) => d.kind === 'bank');
    assert.equal(bank.verified, true);
    assert.equal(bank.documentHash, digest);
    assert.equal(
      collector.bankFor({ title: 'Ключевая ставка', content: 'Изменение ставки' }).items.length,
      1
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
