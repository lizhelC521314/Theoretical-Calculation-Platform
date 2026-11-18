/** 验证：M0 baseline vs M1+M2 structure correction */
import * as XLSX from 'xlsx';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { calibrate } from '../src/ai/calibration/run';
import { JCA_POROUS_V11 } from '../src/ai/calibration/strategies/jcaPorousV11';
import { BRAID_STRUCTURE_V1, BRAID_M0_V1, BRAID_M1_V1 } from '../src/ai/calibration/strategies/braidStructureV1';
import { wovenTubeModel, wovenTubeInputs } from '../src/ai/calibration/adapters/wovenTube';
import type { CalibrationDataset } from '../src/ai/calibration/types';

const filePath = process.argv[2] ?? '公式梳理/编织管/test1.xlsx';
const outDir = process.argv[3] ?? 'reports/ai-calibration';

const wb = XLSX.read(readFileSync(filePath), { type: 'buffer' });
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, blankrows: false }) as any[];
const points = [];
for (let i = 3; i < rows.length; i++) {
  const x = Number(rows[i][0]);
  const y = Number(rows[i][1]);
  if (Number.isFinite(x) && Number.isFinite(y) && x > 0) points.push({ f: x, y });
}
console.log(`Data: ${points.length} points, ${points[0].f}~${points[points.length - 1].f} Hz`);

const D = 50, L = 300, t = 2.7, fp = 1400;
const dataset: CalibrationDataset = {
  id: 'test1', formulaId: 'acoustics.muffler.wovenTube', quantity: 'TL', unit: 'dB',
  inputs: wovenTubeInputs({ D, L, t, fp }), points, groupId: 'L300', hash: 'test1-debug',
};

mkdirSync(outDir, { recursive: true });

const runOne = (name: string, strategy: any) => {
  const report = calibrate({
    strategy, dataset, model: wovenTubeModel, seed: 20261118, fast: false,
  });
  const pstr = report.params.map((p) => `${p.key}=${p.value.toFixed(4)}`).join(', ');
  console.log(`\n[${name}]`);
  console.log(`  params: ${pstr}`);
  console.log(`  RMSE ${report.metrics.rmse.toFixed(3)} dB, MAE ${report.metrics.mae.toFixed(3)}`);
  console.log(`  峰值偏差 ${report.metrics.peakFreqDevPct.toFixed(1)}%, 最大带误差 ${report.metrics.maxAbsBandErr.toFixed(3)} dB`);
  console.log(`  J=${report.objective.J.toFixed(4)}, 条件数 ${report.diagnostics.conditionNumber.toExponential(2)}`);
  return report;
};

// M0 baseline (current strategy on full 20-5000)
runOne('M0 baseline (20-5000 Hz)', JCA_POROUS_V11);

// M0 baseline on 100-2000 Hz
runOne('M0 baseline (100-2000 Hz)', BRAID_M0_V1);

// M0 → M1 only (epsilon_L + C_R/A_L/B_L)
runOne('M1 + C_R/A_L/B_L (100-2000 Hz)', BRAID_M1_V1);

// Full M1+M2
runOne('M1+M2 full (100-2000 Hz)', BRAID_STRUCTURE_V1);
