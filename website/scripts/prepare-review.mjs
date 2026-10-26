import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { loadProfiles } from '../server/profiles.mjs';
import { rankDocument } from '../server/ranking.mjs';

const output = process.argv[2];
if (!output)
  throw new Error('Usage: node scripts/prepare-review.mjs OUTPUT_DIRECTORY [--generate]');
const project = fileURLToPath(new URL('../', import.meta.url));
if ((resolve(output) + sep).startsWith(project))
  throw new Error('Keep review material outside the repository');
try {
  const previous = JSON.parse(await readFile(join(output, 'review.json'), 'utf8'));
  if (previous.entries.some((e) => e.reviewer?.trim()))
    throw new Error('Do not overwrite a reviewed packet; choose a new directory');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const runtime = process.env.APP_DATA_DIR || join(homedir(), '.alfa-business', 'runtime');
const state = JSON.parse(await readFile(join(runtime, 'service.json'), 'utf8'));
const catalog = await loadProfiles();
if (!catalog) throw new Error('Build profiles first');
const documents = state.documents.filter((d) => d.kind === 'news' && d.status === 'ready');
const seen = new Set(),
  profiles = catalog.rows.filter((profile) => {
    const division = profile.okvedCode.split('.')[0];
    if (seen.has(division) || seen.size >= 4) return false;
    seen.add(division);
    return true;
  });
const entries = [];
const origin = process.env.REVIEW_BASE_URL || 'http://127.0.0.1:4173';
const target = new URL(origin);
if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.protocol !== 'http:')
  throw new Error('Use a local server');
const response = await fetch(origin + '/api/session');
const session = await response.json();
if (!session.authenticated) throw new Error('Local read access required');
const cookie = response.headers
  .getSetCookie()
  .map((s) => s.split(';')[0])
  .join('; ');
for (const profile of profiles) {
  const feedResponse = await fetch(
    origin + '/api/feed?company_id=' + encodeURIComponent(profile.syntheticU),
    { headers: { Cookie: cookie } }
  );
  if (!feedResponse.ok) throw new Error('Could not read feed for review');
  const top = (await feedResponse.json())
    .map((card) => ({
      news: {
        id: card.news_id,
        title: card.title,
        content: card.source_excerpt,
        source: card.facts.sources[0]?.url,
        publishedAt: card.date,
        sourceRecords: card.publications,
        memberIds: card.member_ids,
        contentScope: card.content_scope,
      },
      tier: card.bucket === 'focus' ? 'Focus' : 'All',
      score: card.score,
      analysis: card.analysis_payload,
    }))
    .filter((row) => row.tier !== 'Hidden' && row.score >= 0.4)
    .slice(0, 5);
  top.forEach((row, index) =>
    entries.push({
      sampleId: profile.syntheticU + ':' + row.news.id,
      cohort: 'top5',
      company: profile,
      news: row.news,
      position: index + 1,
      predictedScore: row.score,
      relevant: null,
      factsCorrect: null,
      actionsUseful: null,
      bankAttributionCorrect: null,
      reviewer: '',
      comment: '',
      analysis: row.analysis,
    })
  );
  // A separate negative cohort helps reviewers find omissions; it is not a recall estimate.
  documents
    .filter((d) => rankDocument(profile, d).tier === 'Hidden')
    .sort((a, b) => a.id.localeCompare(b.id))
    .slice(0, 2)
    .forEach((d) =>
      entries.push({
        sampleId: profile.syntheticU + ':' + d.id,
        cohort: 'hidden-audit',
        company: profile,
        news: {
          id: d.id,
          title: d.title,
          content: d.text,
          source: d.url,
          publishedAt: d.publishedAt,
        },
        position: null,
        predictedScore: 0,
        relevant: null,
        factsCorrect: null,
        actionsUseful: null,
        bankAttributionCorrect: null,
        reviewer: '',
        comment: '',
        analysis: null,
      })
    );
}
if (process.argv.includes('--generate')) {
  if (!session.authenticated || !session.permissions.includes('analyze'))
    throw new Error('Local analysis access required');
  for (const entry of entries.filter((e) => e.cohort === 'top5')) {
    if (entry.analysis?.quality?.valid === true) continue;
    const result = await fetch(origin + '/api/ai/analysis', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
        Origin: origin,
        'X-CSRF-Token': session.csrfToken,
      },
      body: JSON.stringify({ companyId: entry.company.syntheticU, newsId: entry.news.id }),
      signal: AbortSignal.timeout(240000),
    });
    const analysis = await result.json();
    if (!result.ok) {
      console.log(
        JSON.stringify({ sampleId: entry.sampleId, status: 'failed', code: analysis.code })
      );
      if (
        ['AI_BUDGET_EXCEEDED', 'AI_ACCESS_DENIED', 'AI_RATE_LIMIT', 'USER_RATE_LIMIT'].includes(
          analysis.code
        )
      )
        break;
      continue;
    }
    entry.analysis = analysis;
    console.log(
      JSON.stringify({
        sampleId: entry.sampleId,
        status: 'ready',
        cached: analysis.cached === true,
      })
    );
  }
}
const packet = {
  version: 1,
  createdAt: new Date().toISOString(),
  independentValidation: false,
  selection:
    'Top-5 for four distinct OKVED divisions, plus a separate hidden-news audit. No benchmark examples. Human labels are empty.',
  sourceFingerprint: createHash('sha256')
    .update(JSON.stringify(documents.map((d) => [d.id, d.contentHash]).sort()))
    .digest('hex'),
  entries,
};
await mkdir(output, { recursive: true });
await writeFile(join(output, 'review.json'), JSON.stringify(packet, null, 2), { mode: 0o600 });
const escape = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
const sourceLink = (value) => {
  try {
    const url = new URL(value);
    if (['http:', 'https:'].includes(url.protocol))
      return '<p><a href="' + escape(url.href) + '">Источник новости</a></p>';
  } catch {}
  return '<p>Первоисточник не передан. Факты требуют проверки.</p>';
};
const html = entries
  .map(
    (e) =>
      '<article><small>' +
      escape(e.sampleId) +
      ' · ' +
      escape(e.cohort) +
      '</small><h2>' +
      escape(e.news.title) +
      '</h2><p><b>' +
      escape(e.company.industry) +
      '</b> · ' +
      escape(e.company.region) +
      '</p><p>' +
      escape(e.news.content) +
      '</p>' +
      sourceLink(e.news.source) +
      (e.analysis
        ? '<h3>Вывод модели</h3><p>' +
          escape(e.analysis.analysis.whyImportant.text) +
          '</p><h3>Действия</h3><ul>' +
          e.analysis.analysis.actions.map((a) => '<li>' + escape(a.text) + '</li>').join('') +
          '</ul><details><summary>Полный разбор и основания</summary><pre>' +
          escape(JSON.stringify(e.analysis, null, 2)) +
          '</pre></details>'
        : '<p>Персональный разбор ещё не подготовлен.</p>') +
      '<p>Оцените в review.json: relevant, factsCorrect, actionsUseful, bankAttributionCorrect. Укажите reviewer и comment. null означает «не оценено».</p></article>'
  )
  .join('');
await writeFile(
  join(output, 'review.html'),
  '<!doctype html><html lang="ru"><meta charset="utf-8"><title>Независимая проверка</title><style>body{font:16px/1.6 system-ui;max-width:960px;margin:36px auto;padding:20px;background:#f5f5f2;color:#222}article{background:white;padding:28px;margin:24px 0;border:1px solid #ddd;border-radius:12px}pre{white-space:pre-wrap;overflow-wrap:anywhere}small{color:#666}a{color:#a42129}</style><h1>Выборка для эксперта</h1><p>Не изменяйте тексты и состав выборки. Оценивайте по первоисточникам, отдельно отмечайте неизвестные сведения. Эти материалы ещё не являются результатом независимой проверки.</p>' +
    html +
    '</html>',
  { mode: 0o600 }
);
console.log(
  JSON.stringify({
    top5: entries.filter((e) => e.cohort === 'top5').length,
    hidden: entries.filter((e) => e.cohort === 'hidden-audit').length,
    analyses: entries.filter((e) => e.analysis).length,
    humanReviews: 0,
  })
);
