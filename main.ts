import { cpSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildBoard, validateBoard } from './lib/model.ts';
import { buildDossier, canonicalJson } from './vendor/makefun-board.ts';

const args = process.argv.slice(2);
const inputArg = args.indexOf('--input');
const outputArg = args.indexOf('--output');
const inputValue = inputArg >= 0 ? args[inputArg + 1] : join(process.env.MAKEFUN_INPUT_DIR ?? '/input', 'snapshot.json');
const outputValue = outputArg >= 0 ? args[outputArg + 1] : process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const botDir = resolve(process.env.MAKEFUN_BOT_DIR ?? import.meta.dirname);
if (!inputValue) throw new Error('--input requires a path');
if (!outputValue) throw new Error('--output requires a path');
const resolvedInput = resolve(inputValue);
const inputFile = statSync(resolvedInput).isDirectory() ? join(resolvedInput, 'snapshot.json') : resolvedInput;
const outputDir = resolve(outputValue);
const input = JSON.parse(readFileSync(inputFile, 'utf8'));
const { rows, live_market, stats, model } = buildBoard(input);
validateBoard(rows, input.watchlist);
mkdirSync(outputDir, { recursive: true });
for (const name of ['dashboard', 'screenshots']) cpSync(join(botDir, name), join(outputDir, name), { recursive: true });
writeFileSync(join(outputDir, 'board.json'), `${canonicalJson({ rows })}\n`);
writeFileSync(join(outputDir, 'data.js'), `globalThis.TOKEN_RADAR_DATA=${canonicalJson({
  as_of: input.as_of,
  floor_usd: input.floor_usd,
  ...stats,
  model_version: model.model_version,
  model,
  rows,
  live_rows: live_market,
})};\n`);
writeFileSync(join(outputDir, 'dossier.json'), Buffer.from(buildDossier(outputDir, {
  text_max_bytes: 65536,
  screenshots: { max: 3, max_bytes: 512 * 1024 },
  dashboard: { max_files: 400, max_bytes: 4 * 1024 * 1024 },
})));
