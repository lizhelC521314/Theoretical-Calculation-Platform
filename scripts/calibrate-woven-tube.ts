/**
 * 编织管传递损失模型 —— 自动标定 CLI
 *
 * 用法：
 *   npx vite-node scripts/calibrate-woven-tube.ts --file test1.xlsx \
 *     --D 50 --L 300 --t 2.7 --fp 1400 --fmin 20 --fmax 5000
 *
 * 输出：reports/ai-calibration/*.json 与 *.md
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as XLSX from 'xlsx';
import { calibrate } from '../src/ai/calibration/run';
import { JCA_POROUS_V11 } from '../src/ai/calibration/strategies/jcaPorousV11';
import { wovenTubeModel, wovenTubeInputs } from '../src/ai/calibration/adapters/wovenTube';
import { renderReportMarkdown } from '../src/ai/calibration/report';
import { renderFitChartSvg, renderResidualChartSvg } from '../src/ai/calibration/chart';
import type { CalibrationDataset } from '../src/ai/calibration/types';

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && i + 1 < process.argv.length && !process.argv[i + 1].startsWith('--')) {
    return process.argv[i + 1];
  }
  return fallback;
}

const num = (name: string, fallback: number) => {
  const v = arg(name);
  return v === undefined ? fallback : Number(v);
};

const file = arg('file');
if (!file || !fs.existsSync(file)) {
  console.error('缺少 --file，或文件不存在');
  process.exit(1);
}

const sheetName = arg('sheet');
const skip = num('skip', 3);
const D = num('D', 50);
const L = num('L', 300);
const t = num('t', 2.7);
const fp = num('fp', 1400);
const fmin = num('fmin', 20);
const fmax = num('fmax', 5000);
const outDir = arg('out', path.join('reports', 'ai-calibration')) as string;
const seed = num('seed', 20261118);
const fast = process.argv.includes('--fast');

const wb = XLSX.read(fs.readFileSync(file), { type: 'buffer' });
const ws = wb.Sheets[sheetName ?? wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json<(number | string)[]>(ws, { header: 1 });
const points: { f: number; y: number }[] = [];
for (let i = skip; i < rows.length; i++) {
  const r = rows[i];
  if (!r) continue;
  const f = Number(r[0]);
  const y = Number(r[1]);
  if (Number.isFinite(f) && Number.isFinite(y) && f > 0) points.push({ f, y });
}
if (points.length === 0) {
  console.error('未解析到有效数据点');
  process.exit(1);
}

const hash = crypto
  .createHash('sha256')
  .update(points.map((p) => `${p.f},${p.y}`).join(';'))
  .digest('hex');

const dataset: CalibrationDataset = {
  id: path.basename(file),
  formulaId: JCA_POROUS_V11.formulaId,
  quantity: 'TL',
  unit: 'dB',
  inputs: wovenTubeInputs({ D, L, t, fp }),
  points,
  groupId: `${path.basename(file, path.extname(file))}@L${L}`,
  hash,
};

const strategy = {
  ...JCA_POROUS_V11,
  bands: { ...JCA_POROUS_V11.bands, minHz: fmin, maxHz: fmax },
  optimizer: fast
    ? { ...JCA_POROUS_V11.optimizer, starts: 4, maxIter: 600 }
    : JCA_POROUS_V11.optimizer,
};

const started = Date.now();
const report = calibrate({
  strategy,
  dataset,
  model: wovenTubeModel,
  formulaVersion: '3.0.0',
  seed,
  fast,
});
const elapsed = Date.now() - started;

fs.mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const base = path.join(outDir, `woven-tube-calib-${stamp}`);
const stem = path.basename(base);
const curveFile = `${stem}-fit.svg`;
const residualFile = `${stem}-residual.svg`;
fs.writeFileSync(`${base}.json`, JSON.stringify(report, null, 2), 'utf8');
fs.writeFileSync(path.join(outDir, curveFile), renderFitChartSvg(report), 'utf8');
fs.writeFileSync(path.join(outDir, residualFile), renderResidualChartSvg(report), 'utf8');
fs.writeFileSync(
  `${base}.md`,
  renderReportMarkdown(report, { curveFile, residualFile }),
  'utf8',
);

console.log('=== 标定完成 ===');
console.log(`数据点：${points.length}，有效频带：${report.bands.filter((b) => b.included).length}`);
for (const p of report.params) {
  const boot = p.ciBootstrap ? `，bootstrap [${p.ciBootstrap[0].toFixed(4)}, ${p.ciBootstrap[1].toFixed(4)}]` : '';
  console.log(`${p.key} = ${p.value.toFixed(5)} ± ${p.stdErr.toFixed(4)}（95% CI [${p.ci95[0].toFixed(4)}, ${p.ci95[1].toFixed(4)}]${boot}）`);
}
console.log(`J = ${report.objective.J.toFixed(4)}，RMSE = ${report.metrics.rmse.toFixed(3)} dB，MAE = ${report.metrics.mae.toFixed(3)} dB`);
console.log(`峰值偏差 ${report.metrics.peakFreqDevPct.toFixed(1)}%，条件数 ${report.diagnostics.conditionNumber.toExponential(2)}`);
console.log(`耗时 ${(elapsed / 1000).toFixed(1)} s`);
if (report.warnings.length) {
  console.log('告警：');
  for (const w of report.warnings) console.log(`  - ${w}`);
}
console.log(`报告：${base}.json / .md / .svg`);
