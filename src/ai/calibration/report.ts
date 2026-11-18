/**
 * 标定报告渲染（说明第 9.3 节"报告必须包含"的字段）
 */

import type { CalibrationReport } from './types';

const fx = (v: number, d = 3) => (Number.isFinite(v) ? v.toFixed(d) : '—');

export interface ReportFigures {
  /** 拟合曲线 SVG 文件名（与报告同目录） */
  curveFile?: string;
  /** 残差图 SVG 文件名（与报告同目录） */
  residualFile?: string;
}

export function renderReportMarkdown(r: CalibrationReport, figures?: ReportFigures): string {
  const lines: string[] = [];
  lines.push('# 编织管传递损失模型参数标定报告');
  lines.push('');
  lines.push('## 1 版本与来源');
  lines.push('');
  lines.push(`- 公式：${r.formula.id}（v${r.formula.version}）`);
  lines.push(`- 策略：${r.strategy.id}/${r.strategy.version}`);
  lines.push(`- 算法：${r.strategy.algorithm}`);
  lines.push(`- 数据集：${r.dataset.id}（${r.dataset.points} 点，${r.dataset.quantity} / ${r.dataset.unit}）`);
  lines.push(`- 数据哈希：\`${r.dataset.hash}\``);
  lines.push(`- 分组：${r.dataset.groupId}`);
  lines.push(
    `- 样件：D=${fx((r.dataset.inputs.D ?? 0) * 1000, 1)} mm、L=${fx((r.dataset.inputs.L ?? 0) * 1000, 1)} mm、t=${fx((r.dataset.inputs.t ?? 0) * 1000, 2)} mm、f_p=${fx(r.dataset.inputs.fp ?? Number.NaN, 0)} Hz`,
  );
  lines.push(`- 生成时间：${r.createdAt}`);
  lines.push('');
  lines.push('## 2 有效频带');
  lines.push('');
  const inc = r.bands.filter((b) => b.included);
  lines.push(`共 ${r.bands.length} 个标称 1/3 倍频带，有效 ${inc.length} 个：`);
  lines.push('');
  lines.push('| 中心 Hz | 点数 | 覆盖 | 实测 | 模型 | 残差 | 权重 |');
  lines.push('|---:|---:|---:|---:|---:|---:|---:|');
  for (const b of inc) {
    lines.push(
      `| ${b.center} | ${b.n} | ${(b.coverage * 100).toFixed(0)}% | ${fx(b.test, 2)} | ${fx(b.model, 2)} | ${fx(b.residual, 2)} | ${b.weight.toFixed(3)} |`,
    );
  }
  if (r.excludedBands.length > 0) {
    lines.push('');
    lines.push('剔除频带及原因：');
    for (const e of r.excludedBands) lines.push(`- ${e.center} Hz：${e.reason}`);
  }
  lines.push('');
  lines.push('## 3 目标函数与权重');
  lines.push('');
  lines.push(
    `- Huber δ = ${r.objective.huberDelta} dB；正则 λ = ${r.objective.lambda}；峰值惩罚 λ_p = ${r.objective.lambdaPeak}${r.objective.peakPenaltyEnabled ? '' : '（峰值不显著，未启用）'}`,
  );
  lines.push(`- 目标值 J = ${fx(r.objective.J, 4)}`);
  lines.push(`- 频带权重：≥100 Hz 取 1，<100 Hz 取 0.3，已归一化`);
  lines.push('');
  lines.push('## 4 参数估计');
  lines.push('');
  lines.push('| 参数 | 初值 | 估计值 | 标准误 | 95% CI（JᵀJ） | 95% CI（bootstrap） | 贴边 |');
  lines.push('|---|---:|---:|---:|---|---|---|');
  for (const p of r.params) {
    lines.push(
      `| ${p.key} | ${fx(p.initial, 4)} | ${fx(p.value, 4)} | ${fx(p.stdErr, 4)} | [${fx(p.ci95[0], 4)}, ${fx(p.ci95[1], 4)}] | ${
        p.ciBootstrap ? `[${fx(p.ciBootstrap[0], 4)}, ${fx(p.ciBootstrap[1], 4)}]` : '—'
      } | ${p.atBound ? '是' : '否'} |`,
    );
  }
  lines.push('');
  lines.push(`- 条件数：${Number.isFinite(r.diagnostics.conditionNumber) ? r.diagnostics.conditionNumber.toExponential(2) : '—'}`);
  if (r.diagnostics.correlation.length > 0) {
    lines.push('- 相关矩阵：');
    for (const row of r.diagnostics.correlation) lines.push(`  - [${row.map((v) => v.toFixed(2)).join(', ')}]`);
  }
  lines.push('');
  lines.push('## 5 优化过程');
  lines.push('');
  lines.push(`- 多起点：${r.optimizer.starts} 个（1 个上版初值 + LHS${r.optimizer.starts - 1} 个）`);
  lines.push(`- 求值次数：${r.optimizer.evaluations}；是否收敛：${r.optimizer.converged ? '是' : '否'}`);
  lines.push(`- 多解判定：${r.optimizer.multiSolution ? '存在多解（前 3 解差异 > 5%）' : '未发现多解'}`);
  lines.push('');
  lines.push('| 起点 | J | 参数 | 求值次数 |');
  lines.push('|---:|---:|---|---:|');
  for (const s of r.optimizer.solutions) {
    lines.push(
      `| ${s.index} | ${fx(s.J, 4)} | ${Object.entries(s.params)
        .map(([k, v]) => `${k}=${fx(v, 4)}`)
        .join(', ')} | ${s.evaluations} |`,
    );
  }
  lines.push('');
  lines.push('## 6 指标');
  lines.push('');
  lines.push('| 指标 | 数值 | 阈值 | 结论 |');
  lines.push('|---|---:|---:|---|');
  for (const c of r.metrics.checks) {
    lines.push(`| ${c.label} | ${fx(c.value, 2)} | ≤ ${c.limit} | ${c.pass ? '通过' : '未通过'} |`);
  }
  lines.push('');
  lines.push('## 7 验证');
  lines.push('');
  lines.push(`- 方法：${r.validation.method}`);
  lines.push(`- 状态：${r.validation.status === 'validated' ? '已验证' : '仅标定（未验证）'}`);
  lines.push(`- 说明：${r.validation.note}`);
  if (r.validation.trainRmse !== undefined && r.validation.holdoutRmse !== undefined) {
    lines.push(`- 训练集 RMSE ${fx(r.validation.trainRmse, 2)} dB；留出集 RMSE ${fx(r.validation.holdoutRmse, 2)} dB`);
  }
  lines.push('');
  lines.push('## 8 f_p 敏感性');
  lines.push('');
  lines.push('| f_p 倍率 | f_p (Hz) | RMSE (dB) |');
  lines.push('|---:|---:|---:|');
  for (const s of r.sensitivity) lines.push(`| ${s.fpScale} | ${fx(s.fp, 0)} | ${fx(s.rmse, 2)} |`);
  lines.push('');
  lines.push('## 9 告警');
  lines.push('');
  if (r.warnings.length === 0) lines.push('- 无');
  for (const w of r.warnings) lines.push(`- ${w}`);
  lines.push('');
  if (figures?.curveFile || figures?.residualFile) {
    lines.push('## 10 图形');
    lines.push('');
    if (figures.curveFile) lines.push(`![实测/模型拟合曲线](${figures.curveFile})`, '');
    if (figures.residualFile) lines.push(`![逐带残差](${figures.residualFile})`, '');
  }
  return lines.join('\n');
}
