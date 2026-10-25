import { parentPort, workerData } from 'node:worker_threads';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from '@napi-rs/canvas';
import { createWorker } from 'tesseract.js';
import { createRequire } from 'node:module';
import { mkdir, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
const require = createRequire(import.meta.url);
let ocr;
try {
  const loading = getDocument({
    data: workerData.bytes || workerData,
    isEvalSupported: false,
    useSystemFonts: false,
    disableFontFace: true,
    stopAtErrors: false,
  });
  const pdf = await loading.promise;
  const pages = [];
  const options = workerData.options || {};
  const maxPages = Math.min(Number(options.maxPages) || 12, 40);
  let ocrPages = 0;
  for (let i = 1; i <= Math.min(pdf.numPages, maxPages); i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const result = {
      page: i,
      text: content.items
        .map((item) => item.str || '')
        .join(' ')
        .trim(),
      method: 'text',
    };
    if (result.text.length < 40 && options.ocr !== false && ocrPages < (options.maxOcrPages || 6)) {
      if (!ocr) {
        const languageDirectory = join(
          process.env.APP_DATA_DIR || join(homedir(), '.alfa-business', 'runtime'),
          'ocr-models'
        );
        await mkdir(languageDirectory, { recursive: true });
        await Promise.all(
          ['rus', 'eng'].map(async (code) => {
            const { langPath } = require('@tesseract.js-data/' + code);
            await copyFile(
              join(langPath, code + '.traineddata.gz'),
              join(languageDirectory, code + '.traineddata.gz')
            );
          })
        );
        ocr = await createWorker('rus+eng', 1, {
          cacheMethod: 'none',
          langPath: languageDirectory,
        });
      }
      const viewport = page.getViewport({ scale: 2.5 });
      if (viewport.width * viewport.height > 12000000) throw new Error('PDF_PAGE_TOO_LARGE');
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      const { data } = await ocr.recognize(canvas.toBuffer('image/png'));
      result.text = data.text.trim();
      result.method = 'ocr';
      result.confidence = data.confidence;
      ocrPages++;
    }
    pages.push(result);
  }
  const totalPages = pdf.numPages;
  await loading.destroy();
  parentPort.postMessage({
    pages,
    totalPages,
    truncated: totalPages > pages.length || pages.some((page) => page.text.length < 40),
    ocrPages,
    scanned: ocrPages > 0 || pages.every((page) => page.text.length < 40),
  });
} catch {
  parentPort.postMessage({ error: 'PDF_UNREADABLE' });
} finally {
  if (ocr) await ocr.terminate();
}
