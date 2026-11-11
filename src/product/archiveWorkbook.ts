/**
 * 型号设计档案 Excel 生成（纯函数，不依赖 Electron）
 *
 * 发布型号时把「需求-参数-校核-基线」导出为一份 Excel；
 * 实际写入共享目录由 archive.ts 调用 api.db.archive 完成。
 *
 * 档案只引用计算记录（公式、版本、结论、输出摘要），不复制计算书正文——
 * 计算书原件仍在理论计算库，避免同一份证据存两处。
 */
import ExcelJS from 'exceljs';
import {
  MODEL_STATUS_LABEL,
  PARAM_SOURCE_LABEL,
  VERIFY_LABEL,
  paramInRange,
  type Baseline,
  type ProductFamily,
  type ProductModel,
} from './types';

/** ArrayBuffer / Uint8Array → base64（渲染进程用 btoa，测试环境用 Buffer） */
function bufToBase64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (typeof btoa === 'function') {
    let bin = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    return btoa(bin);
  }
  const B = (globalThis as { Buffer?: { from(b: Uint8Array): { toString(enc: string): string } } }).Buffer;
  if (B) return B.from(bytes).toString('base64');
  throw new Error('当前环境不支持 base64 编码');
}

const numText = (v: number | null) => (v == null || !Number.isFinite(v) ? '' : String(Number(v.toPrecision(6))));

/** 生成型号设计档案 Excel（base64） */
export async function buildDesignArchiveBase64(
  model: ProductModel,
  family: ProductFamily | null,
  baseline: Baseline,
): Promise<string> {
  const wb = new ExcelJS.Workbook();
  wb.creator = baseline.createdBy || '汽车零部件数字设计平台';
  wb.created = new Date();

  const titleStyle: Partial<ExcelJS.Style> = { font: { bold: true, size: 13 } };
  const headStyle: Partial<ExcelJS.Style> = {
    font: { bold: true, color: { argb: 'FFFFFFFF' } },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A5FB4' } },
    alignment: { horizontal: 'center', vertical: 'middle' },
    border: { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } },
  };
  const cellStyle: Partial<ExcelJS.Style> = {
    alignment: { vertical: 'top', wrapText: true },
    border: { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } },
  };

  const writeHead = (ws: ExcelJS.Worksheet, headers: string[]) => {
    ws.addRow(headers);
    ws.getRow(1).eachCell((c) => {
      c.style = headStyle as ExcelJS.Style;
    });
    ws.views = [{ state: 'frozen', ySplit: 1 }];
  };
  const styleBody = (ws: ExcelJS.Worksheet) => {
    ws.eachRow((row, idx) => {
      if (idx === 1) return;
      row.eachCell((c) => {
        c.style = cellStyle as ExcelJS.Style;
      });
    });
  };

  /* ---------- 型号概况 ---------- */
  const ov = wb.addWorksheet('型号概况', { properties: { defaultColWidth: 18 } });
  ov.addRow(['型号设计档案']);
  ov.getRow(1).getCell(1).style = titleStyle as ExcelJS.Style;
  ov.addRow([]);
  const info: Array<[string, string]> = [
    ['产品族', family ? [family.code, family.name].filter(Boolean).join(' · ') : '未归类'],
    ['型号 P/N', model.id],
    ['型号名称', model.name],
    ['客户', model.customer || '—'],
    ['项目', model.projectId || '—'],
    ['负责人', model.owner || '—'],
    ['当前状态', MODEL_STATUS_LABEL[model.status]],
    ['版本基线', baseline.label],
    ['发布日期', baseline.createdAt],
    ['门禁结论', `通过（错误 ${baseline.errorCount} / 警告 ${baseline.warnCount}）`],
    ['需求项数', String(baseline.requirementCount)],
    ['计算记录数', String(baseline.calcRefIds.length)],
    ['设计标准', model.standards.length ? model.standards.join('\n') : '—'],
    ['基线备注', baseline.note || '—'],
  ];
  for (const [k, v] of info) {
    const row = ov.addRow([k, v]);
    row.getCell(1).font = { bold: true };
    row.getCell(2).alignment = { wrapText: true, vertical: 'top' };
  }

  /* ---------- 需求清单 ---------- */
  const rq = wb.addWorksheet('需求清单');
  writeHead(rq, ['需求项', '目标值', '单位', '方向', '特性', '来源', '验证方式', '备注']);
  for (const r of model.requirements) {
    rq.addRow([
      r.name,
      numText(r.target),
      r.unit,
      r.direction === 'max' ? '不大于' : '不小于',
      r.priority,
      r.source,
      VERIFY_LABEL[r.verify],
      r.note,
    ]);
  }
  rq.columns = [
    { width: 30 },
    { width: 12 },
    { width: 10 },
    { width: 10 },
    { width: 8 },
    { width: 20 },
    { width: 10 },
    { width: 30 },
  ];
  styleBody(rq);

  /* ---------- 关键参数 ---------- */
  const pm = wb.addWorksheet('关键参数');
  writeHead(pm, ['参数名', '参数键', '数值', '单位', '下限', '上限', '来源', '依据', '区间判定']);
  for (const p of model.params) {
    pm.addRow([
      p.label,
      p.key,
      numText(p.value),
      p.unit,
      numText(p.min),
      numText(p.max),
      PARAM_SOURCE_LABEL[p.source],
      p.basis,
      paramInRange(p) ? '在范围内' : '越界或未取值',
    ]);
  }
  pm.columns = [
    { width: 22 },
    { width: 12 },
    { width: 14 },
    { width: 10 },
    { width: 10 },
    { width: 10 },
    { width: 12 },
    { width: 32 },
    { width: 14 },
  ];
  styleBody(pm);

  /* ---------- 计算与校核 ---------- */
  const cr = wb.addWorksheet('计算与校核');
  writeHead(cr, ['记录 ID', '公式', '公式版本', '结论', '关联时间', '输出摘要', '备注']);
  for (const c of model.calcRefs) {
    const outputs = Object.entries(c.outputs)
      .map(([k, v]) => `${k}=${Number(v.toPrecision(6))}`)
      .join('；');
    cr.addRow([
      c.historyId,
      c.formulaTitle,
      c.formulaVersion || '未记录',
      c.conclusion === 'pass' ? '满足' : c.conclusion === 'fail' ? '不满足' : '待判定',
      c.createdAt,
      outputs,
      c.note,
    ]);
  }
  cr.columns = [
    { width: 22 },
    { width: 28 },
    { width: 12 },
    { width: 10 },
    { width: 20 },
    { width: 40 },
    { width: 24 },
  ];
  styleBody(cr);

  /* ---------- 版本基线 ---------- */
  const bl = wb.addWorksheet('版本基线');
  writeHead(bl, ['版本', '时间', '创建人', '需求数', '参数数', '计算记录数', '门禁错误', '门禁警告', '备注']);
  for (const b of model.baselines) {
    bl.addRow([
      b.label,
      b.createdAt,
      b.createdBy,
      b.requirementCount,
      b.params.length,
      b.calcRefIds.length,
      b.errorCount,
      b.warnCount,
      b.note,
    ]);
  }
  bl.columns = [
    { width: 10 },
    { width: 20 },
    { width: 14 },
    { width: 10 },
    { width: 10 },
    { width: 12 },
    { width: 10 },
    { width: 10 },
    { width: 30 },
  ];
  styleBody(bl);

  const buf = await wb.xlsx.writeBuffer();
  return bufToBase64(buf as ArrayBuffer);
}
