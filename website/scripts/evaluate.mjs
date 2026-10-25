import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { evaluateBenchmark } from '../server/quality.mjs';
const [input = new URL('../data/quality-benchmark.json', import.meta.url), output] =
  process.argv.slice(2);
const bytes = await readFile(input);
const result = evaluateBenchmark(JSON.parse(bytes.toString('utf8')), { usedForTuning: true });
result.datasetSha256 = createHash('sha256').update(bytes).digest('hex');
if (output) await writeFile(output, JSON.stringify(result, null, 2));
console.log(
  JSON.stringify(
    {
      version: result.version,
      cases: result.cases.length,
      ...result.metrics,
      failures: result.cases.filter((c) => !c.passed).map((c) => c.id),
    },
    null,
    2
  )
);
if (result.metrics.precision < 0.85 || result.metrics.recall < 0.85) process.exitCode = 1;
