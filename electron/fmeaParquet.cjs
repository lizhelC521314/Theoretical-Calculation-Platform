/**
 * FMEA库 Parquet 存储
 *
 * 一张知识卡片 = 一个单行 Parquet 文件，文件名即编号（FM-2026-001.parquet）。
 * 列定义与 src/report/fmea.ts 的 FmeaRecord 一一对应，
 * 读取时还原为 FmeaRecord JSON 交给渲染进程。
 */
const fs = require('fs');
const path = require('path');
const { ParquetSchema, ParquetWriter, ParquetReader } = require('parquetjs-lite');

const fmeaSchema = new ParquetSchema({
  schema: { type: 'UTF8' },
  id: { type: 'UTF8' },
  system: { type: 'UTF8', optional: true }, // 系统 / 子系统
  machine: { type: 'UTF8', optional: true }, // 机种名称
  part: { type: 'UTF8', optional: true }, // 部件名称
  productCategory: { type: 'UTF8', optional: true }, // 产品大类（A~J）
  productSubCategory: { type: 'UTF8', optional: true }, // 产品小类（A01）
  material: { type: 'UTF8', optional: true }, // 本体使用材料
  failureMode: { type: 'UTF8' }, // 潜在的失效模式
  failureCode: { type: 'UTF8', optional: true }, // 失效模式编码（F01~F18）
  failureModeImage: { type: 'UTF8', optional: true }, // 失效模式图片（标记）
  failureEffect: { type: 'UTF8', optional: true }, // 潜在的失效后果
  failureCause: { type: 'UTF8', optional: true }, // 潜在的失效起因 / 机理
  failureCategory: { type: 'UTF8', optional: true }, // 失效分类
  causeCategory: { type: 'UTF8', optional: true }, // 原因分类
  causeCode: { type: 'UTF8', optional: true }, // 原因编码（D/M/P/Mf）
  riskLevel: { type: 'UTF8', optional: true }, // 风险等级
  severity: { type: 'UTF8', optional: true }, // S
  occurrence: { type: 'UTF8', optional: true }, // O
  detection: { type: 'UTF8', optional: true }, // D
  action: { type: 'UTF8' }, // 建议的措施
  measureType: { type: 'UTF8', optional: true }, // 措施类型
  verificationStatus: { type: 'UTF8', optional: true }, // 验证状态
  designGuide: { type: 'UTF8', optional: true }, // 设计规避
  conclusion: { type: 'UTF8', optional: true }, // 一句话结论
  keywords: { type: 'UTF8', optional: true }, // 关键词 / 同义词
  actionImage: { type: 'UTF8', optional: true }, // 措施对策图片（标记）
  remark: { type: 'UTF8', optional: true },
  owner: { type: 'UTF8', optional: true },
  recordDate: { type: 'UTF8', optional: true },
  sourceSheet: { type: 'UTF8', optional: true },
  citationLog: { type: 'UTF8', optional: true }, // 引用记录（JSON 字符串）
  createdAt: { type: 'UTF8' },
  updatedAt: { type: 'UTF8' },
  createdBy: { type: 'UTF8' },
  createdByDisplay: { type: 'UTF8' },
  updatedBy: { type: 'UTF8' },
  revision: { type: 'INT32' },
  useCount: { type: 'INT32', optional: true },
});

function str(value) {
  return value === null || value === undefined ? '' : String(value);
}

function rowFromRecord(record) {
  return {
    schema: str(record.schema),
    id: str(record.id),
    system: str(record.system),
    machine: str(record.machine),
    part: str(record.part),
    productCategory: str(record.productCategory),
    productSubCategory: str(record.productSubCategory),
    material: str(record.material),
    failureMode: str(record.failureMode),
    failureCode: str(record.failureCode),
    failureModeImage: str(record.failureModeImage),
    failureEffect: str(record.failureEffect),
    failureCause: str(record.failureCause),
    failureCategory: str(record.failureCategory),
    causeCategory: str(record.causeCategory),
    causeCode: str(record.causeCode),
    riskLevel: str(record.riskLevel),
    severity: str(record.severity),
    occurrence: str(record.occurrence),
    detection: str(record.detection),
    action: str(record.action),
    measureType: str(record.measureType),
    verificationStatus: str(record.verificationStatus),
    designGuide: str(record.designGuide),
    conclusion: str(record.conclusion),
    keywords: str(record.keywords),
    actionImage: str(record.actionImage),
    remark: str(record.remark),
    owner: str(record.owner),
    recordDate: str(record.recordDate),
    sourceSheet: str(record.sourceSheet),
    citationLog: Array.isArray(record.citations) ? JSON.stringify(record.citations) : '[]',
    createdAt: str(record.createdAt),
    updatedAt: str(record.updatedAt),
    createdBy: str(record.createdBy),
    createdByDisplay: str(record.createdByDisplay),
    updatedBy: str(record.updatedBy),
    revision: Number(record.revision) > 0 ? Number(record.revision) : 1,
    useCount: Number(record.useCount) > 0 ? Number(record.useCount) : 0,
  };
}

function parseCitations(raw) {
  if (!raw) return [];
  try {
    const list = JSON.parse(String(raw));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function recordFromRow(row) {
  if (!row) return null;
  return {
    schema: row.schema,
    id: row.id,
    system: row.system || '',
    machine: row.machine || '',
    part: row.part || '',
    productCategory: row.productCategory || '',
    productSubCategory: row.productSubCategory || '',
    material: row.material || '',
    failureMode: row.failureMode || '',
    failureCode: row.failureCode || '',
    failureModeImage: row.failureModeImage || '',
    failureEffect: row.failureEffect || '',
    failureCause: row.failureCause || '',
    failureCategory: row.failureCategory || '',
    causeCategory: row.causeCategory || '',
    causeCode: row.causeCode || '',
    riskLevel: row.riskLevel || '',
    severity: row.severity || '',
    occurrence: row.occurrence || '',
    detection: row.detection || '',
    action: row.action || '',
    measureType: row.measureType || '',
    verificationStatus: row.verificationStatus || '',
    designGuide: row.designGuide || '',
    conclusion: row.conclusion || '',
    keywords: row.keywords || '',
    actionImage: row.actionImage || '',
    remark: row.remark || '',
    owner: row.owner || '',
    recordDate: row.recordDate || '',
    sourceSheet: row.sourceSheet || '',
    citations: parseCitations(row.citationLog),
    createdAt: row.createdAt || '',
    updatedAt: row.updatedAt || '',
    createdBy: row.createdBy || '',
    createdByDisplay: row.createdByDisplay || '',
    updatedBy: row.updatedBy || '',
    revision: Number(row.revision) > 0 ? Number(row.revision) : 1,
    useCount: Number(row.useCount) > 0 ? Number(row.useCount) : 0,
  };
}

/** 写入 Parquet；overwrite=false 且目标存在时抛出 code=EEXIST */
async function writeFmeaParquet(filePath, record, overwrite) {
  if (fs.existsSync(filePath) && !overwrite) {
    const err = new Error('同名 FMEA 记录已存在');
    err.code = 'EEXIST';
    throw err;
  }
  const tmpPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${Date.now()}.tmp`);
  try {
    const writer = await ParquetWriter.openFile(fmeaSchema, tmpPath);
    await writer.appendRow(rowFromRecord(record));
    await writer.close();
    if (fs.existsSync(filePath)) fs.rmSync(filePath);
    fs.renameSync(tmpPath, filePath);
  } finally {
    if (fs.existsSync(tmpPath)) fs.rmSync(tmpPath, { force: true });
  }
}

async function readFmeaParquet(filePath) {
  const reader = await ParquetReader.openFile(filePath);
  try {
    const cursor = reader.getCursor();
    const row = await cursor.next();
    return recordFromRow(row);
  } finally {
    await reader.close();
  }
}

module.exports = { writeFmeaParquet, readFmeaParquet };
