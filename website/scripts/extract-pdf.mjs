import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { parsePdf } from '../server/source-parser.mjs';
const [input, output, pages = '6'] = process.argv.slice(2);
if (!input || !output)
  throw new Error('Usage: node scripts/extract-pdf.mjs INPUT.pdf OUTPUT.json [PAGES]');
const project = fileURLToPath(new URL('../', import.meta.url));
if ((resolve(output) + sep).startsWith(project))
  throw new Error('Keep extracted text outside the project');
const bytes = await readFile(input);
if (bytes.length > 12000000 || bytes.subarray(0, 5).toString() !== '%PDF-')
  throw new Error('Invalid PDF');
const extracted = await parsePdf(bytes, { maxPages: Number(pages), maxOcrPages: Number(pages) });
await mkdir(dirname(resolve(output)), { recursive: true });
await writeFile(
  output,
  JSON.stringify(
    { sha256: createHash('sha256').update(bytes).digest('hex'), ...extracted },
    null,
    2
  )
);
console.log(
  JSON.stringify({
    totalPages: extracted.totalPages,
    ocrPages: extracted.ocrPages,
    truncated: extracted.truncated,
    characters: extracted.pages.reduce((n, p) => n + p.text.length, 0),
  })
);
