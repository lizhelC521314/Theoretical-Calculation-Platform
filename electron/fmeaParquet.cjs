/**
 * FMEA 案例库 Parquet 存储
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
  machine: { type: 'UTF8', optional: true }, // 机种名称
  part: { type: 'UTF8', optional: true }, // 部件名称
  material: { type: 'UTF8', optional: true }, // 本体使用材料
  failureMode: { type: 'UTF8' }, // 潜在的失效模式
  failureModeImage: { type: 'UTF8', optional: true }, // 失效模式图片（标记）
  failureEffect: { type: 'UTF8', optional: true }, // 潜在的失效后果
  failureCause: { type: 'UTF8', optional: true }, // 潜在的失效起因 / 机理
  action: { type: 'UTF8' }, // 建议的措施
  actionImage: { type: 'UTF8', optional: true }, // 措施对策图片（标记）
  remark: { type: 'UTF8', optional: true },
  owner: { type: 'UTF8', optional: true },
  recordDate: { type: 'UTF8', optional: true },
  sourceSheet: { type: 'UTF8', optional: true },
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
    machine: str(record.machine),
    part: str(record.part),
    material: str(record.material),
    failureMode: str(record.failureMode),
    failureModeImage: str(record.failureModeImage),
    failureEffect: str(record.failureEffect),
    failureCause: str(record.failureCause),
    action: str(record.action),
    actionImage: str(record.actionImage),
    remark: str(record.remark),
    owner: str(record.owner),
    recordDate: str(record.recordDate),
    sourceSheet: str(record.sourceSheet),
    createdAt: str(record.createdAt),
    updatedAt: str(record.updatedAt),
    createdBy: str(record.createdBy),
    createdByDisplay: str(record.createdByDisplay),
    updatedBy: str(record.updatedBy),
    revision: Number(record.revision) > 0 ? Number(record.revision) : 1,
    useCount: Number(record.useCount) > 0 ? Number(record.useCount) : 0,
  };
}

function recordFromRow(row) {
  if (!row) return null;
  return {
    schema: row.schema,
    id: row.id,
    machine: row.machine || '',
    part: row.part || '',
    material: row.material || '',
    failureMode: row.failureMode || '',
    failureModeImage: row.failureModeImage || '',
    failureEffect: row.failureEffect || '',
    failureCause: row.failureCause || '',
    action: row.action || '',
    actionImage: row.actionImage || '',
    remark: row.remark || '',
    owner: row.owner || '',
    recordDate: row.recordDate || '',
    sourceSheet: row.sourceSheet || '',
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
