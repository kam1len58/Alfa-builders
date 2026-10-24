import { parentPort, workerData } from 'node:worker_threads';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
try {
  const loading = getDocument({
    data: workerData,
    isEvalSupported: false,
    useSystemFonts: false,
    disableFontFace: true,
    stopAtErrors: false,
  });
  const pdf = await loading.promise;
  const pages = [];
  for (let i = 1; i <= Math.min(pdf.numPages, 40); i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    pages.push({
      page: i,
      text: content.items
        .map((item) => item.str || '')
        .join(' ')
        .trim(),
    });
  }
  const totalPages = pdf.numPages;
  await loading.destroy();
  parentPort.postMessage({
    pages,
    totalPages,
    scanned: pages.every((page) => page.text.length < 40),
  });
} catch {
  parentPort.postMessage({ error: 'PDF_UNREADABLE' });
}
