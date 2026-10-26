import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parsePdf } from '../server/source-parser.mjs';

function scannedPdf() {
  const canvas = createCanvas(1200, 400),
    context = canvas.getContext('2d');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, 1200, 400);
  context.fillStyle = '#000';
  context.font = 'bold 70px sans-serif';
  context.fillText('INVOICE TOTAL 12345', 50, 220);
  const jpeg = canvas.toBuffer('image/jpeg');
  const stream = Buffer.from('q 600 0 0 200 0 0 cm /Img Do Q');
  const objects = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from(
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 200] /Resources << /XObject << /Img 4 0 R >> >> /Contents 5 0 R >>'
    ),
    Buffer.concat([
      Buffer.from(
        '<< /Type /XObject /Subtype /Image /Width 1200 /Height 400 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' +
          jpeg.length +
          ' >>\nstream\n'
      ),
      jpeg,
      Buffer.from('\nendstream'),
    ]),
    Buffer.concat([
      Buffer.from('<< /Length ' + stream.length + ' >>\nstream\n'),
      stream,
      Buffer.from('\nendstream'),
    ]),
  ];
  const parts = [Buffer.from('%PDF-1.4\n')],
    offsets = [0];
  let size = parts[0].length;
  objects.forEach((object, i) => {
    offsets.push(size);
    const part = Buffer.concat([
      Buffer.from(i + 1 + ' 0 obj\n'),
      object,
      Buffer.from('\nendobj\n'),
    ]);
    parts.push(part);
    size += part.length;
  });
  parts.push(
    Buffer.from(
      'xref\n0 6\n0000000000 65535 f \n' +
        offsets
          .slice(1)
          .map((n) => String(n).padStart(10, '0') + ' 00000 n \n')
          .join('') +
        'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' +
        size +
        '\n%%EOF'
    )
  );
  return Buffer.concat(parts);
}
test(
  'OCR действительно распознаёт скан без текстового слоя; обычный парсер этого не делает',
  { timeout: 120000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'alfa-ocr-'));
    const previous = process.env.APP_DATA_DIR;
    process.env.APP_DATA_DIR = root;
    try {
      const bytes = scannedPdf();
      const plain = await parsePdf(bytes, { ocr: false });
      assert.equal(plain.pages[0].text, '');
      const result = await parsePdf(bytes, { maxPages: 1 });
      assert.equal(result.ocrPages, 1);
      assert.match(result.pages[0].text, /12345/);
      assert.match(result.pages[0].text, /INVOICE/i);
      assert.ok(result.pages[0].confidence > 50);
    } finally {
      if (previous === undefined) delete process.env.APP_DATA_DIR;
      else process.env.APP_DATA_DIR = previous;
      await rm(root, { recursive: true, force: true });
    }
  }
);
