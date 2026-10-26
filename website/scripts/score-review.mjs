import { readFile } from 'node:fs/promises';
import { scoreReviewPacket } from '../server/review-metrics.mjs';
const packet = JSON.parse(await readFile(process.argv[2], 'utf8'));
console.log(JSON.stringify(scoreReviewPacket(packet), null, 2));
