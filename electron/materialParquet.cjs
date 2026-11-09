/**
 * 材料库 Parquet 存储
 *
 * 每条材料记录保存为一个单行 Parquet 文件，列定义：
 *   schema / type / grade / series / supplier / state / temperature
 *   density / poisson / elasticModulus / direction / hardness
 *   tensileStrength / failureStrain / specificHeat / thermalConductivity / expansionCoefficient
 *   stressStrainCurveJson / fatigueCurveJson（曲线以 JSON 字符串保存）
 *   createdAt / updatedAt / createdBy / createdByDisplay / updatedBy / revision
 * 数值缺失时写 null（可选列），读取时还原为 MaterialRecord JSON。
 */
const fs = require('fs');
const path = require('path');
const { ParquetSchema, ParquetWriter, ParquetReader } = require('parquetjs-lite');

const materialSchema = new ParquetSchema({
  schema: { type: 'UTF8' },
  type: { type: 'UTF8' },
  name: { type: 'UTF8', optional: true },             // 名称（流体必填，其余类型为空串）
  grade: { type: 'UTF8' },
  series: { type: 'UTF8' },
  supplier: { type: 'UTF8', optional: true },
  state: { type: 'UTF8', optional: true },           // wet=湿态 / dry=干态（旧文件无此列→湿态）
  temperature: { type: 'DOUBLE', optional: true },   // 流体为 null（温度在属性表内）
  density: { type: 'DOUBLE', optional: true },       // kg/m³
  poisson: { type: 'DOUBLE', optional: true },
  elasticModulus: { type: 'DOUBLE', optional: true },
  direction: { type: 'DOUBLE', optional: true },     // °
  hardness: { type: 'DOUBLE', optional: true },      // HB/HV/HRC/... 仅数值
  tensileStrength: { type: 'DOUBLE', optional: true },
  failureStrain: { type: 'DOUBLE', optional: true },  // %
  specificHeat: { type: 'DOUBLE', optional: true },   // 比热容 Cp，J/(kg·℃)
  thermalConductivity: { type: 'DOUBLE', optional: true }, // 热导率 K，W/(m·℃)
  expansionCoefficient: { type: 'DOUBLE', optional: true }, // 膨胀系数，mm/(mm·K)
  stressStrainCurveJson: { type: 'UTF8', optional: true },
  fatigueCurveJson: { type: 'UTF8', optional: true },
  fluidTableJson: { type: 'UTF8', optional: true },   // 流体属性表（仅 fluid 类型）
  porousJson: { type: 'UTF8', optional: true },       // 多孔介质参数（仅 porous 类型）
  createdAt: { type: 'UTF8' },
  updatedAt: { type: 'UTF8' },
  createdBy: { type: 'UTF8' },
  createdByDisplay: { type: 'UTF8' },
  updatedBy: { type: 'UTF8' },
  revision: { type: 'INT32' },
});

function nullable(value) {
  return value === null || value === undefined ? null : value;
}

function rowFromRecord(record) {
  return {
    schema: String(record.schema || ''),
    type: String(record.type || ''),
    name: String(record.name || ''),
    grade: String(record.grade || ''),
    series: String(record.series || ''),
    supplier: String(record.supplier || ''),
    state: record.state === 'dry' ? 'dry' : 'wet',
    temperature: nullable(record.temperature),
    density: nullable(record.density),
    poisson: nullable(record.poisson),
    elasticModulus: nullable(record.elasticModulus),
    direction: nullable(record.direction),
    hardness: nullable(record.hardness),
    tensileStrength: nullable(record.tensileStrength),
    failureStrain: nullable(record.failureStrain),
    specificHeat: nullable(record.specificHeat),
    thermalConductivity: nullable(record.thermalConductivity),
    expansionCoefficient: nullable(record.expansionCoefficient),
    stressStrainCurveJson: record.stressStrainCurve ? JSON.stringify(record.stressStrainCurve) : null,
    fatigueCurveJson: record.fatigueCurve ? JSON.stringify(record.fatigueCurve) : null,
    fluidTableJson:
      Array.isArray(record.fluidPoints) && record.fluidPoints.length
        ? JSON.stringify(record.fluidPoints)
        : null,
    porousJson:
      record.type === 'porous' && record.porousProps ? JSON.stringify(record.porousProps) : null,
    createdAt: String(record.createdAt || ''),
    updatedAt: String(record.updatedAt || ''),
    createdBy: String(record.createdBy || ''),
    createdByDisplay: String(record.createdByDisplay || ''),
    updatedBy: String(record.updatedBy || ''),
    revision: Number(record.revision) > 0 ? Number(record.revision) : 1,
  };
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseCurve(value) {
  if (!value || typeof value !== 'string') return null;
  try {
    const curve = JSON.parse(value);
    if (!curve || !Array.isArray(curve.points) || !curve.points.length) return null;
    const points = curve.points
      .filter((p) => p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y)))
      .map((p) => ({ x: Number(p.x), y: Number(p.y) }));
    if (!points.length) return null;
    return { sourceName: typeof curve.sourceName === 'string' ? curve.sourceName : '', points };
  } catch {
    return null;
  }
}

function parseFluidTable(value) {
  if (!value || typeof value !== 'string') return null;
  try {
    const arr = JSON.parse(value);
    if (!Array.isArray(arr) || !arr.length) return null;
    const keys = ['temperature', 'density', 'dynamicViscosity', 'thermalConductivity', 'specificHeat'];
    const points = arr
      .filter((p) => p && keys.every((k) => Number.isFinite(Number(p[k]))))
      .map((p) => ({
        temperature: Number(p.temperature),
        density: Number(p.density),
        dynamicViscosity: Number(p.dynamicViscosity),
        thermalConductivity: Number(p.thermalConductivity),
        specificHeat: Number(p.specificHeat),
      }));
    return points.length ? points : null;
  } catch {
    return null;
  }
}

function parsePorous(value) {
  if (!value || typeof value !== 'string') return null;
  try {
    const p = JSON.parse(value);
    if (!p || typeof p !== 'object') return null;
    return {
      poreSize: numberOrNull(p.poreSize),
      viscousResistance: numberOrNull(p.viscousResistance),
      inertialResistance: numberOrNull(p.inertialResistance),
      viscousCoefficient: numberOrNull(p.viscousCoefficient),
      inertialCoefficient: numberOrNull(p.inertialCoefficient),
      remark: typeof p.remark === 'string' ? p.remark : '',
    };
  } catch {
    return null;
  }
}

function recordFromRow(row) {
  if (!row) return null;
  return {
    schema: row.schema,
    type: row.type,
    name: row.name || '',
    grade: row.grade || '',
    series: row.series || '',
    supplier: row.supplier || '',
    state: row.state === 'dry' ? 'dry' : 'wet',
    temperature: numberOrNull(row.temperature),
    density: numberOrNull(row.density),
    poisson: numberOrNull(row.poisson),
    elasticModulus: numberOrNull(row.elasticModulus),
    direction: numberOrNull(row.direction),
    hardness: numberOrNull(row.hardness),
    tensileStrength: numberOrNull(row.tensileStrength),
    failureStrain: numberOrNull(row.failureStrain),
    specificHeat: numberOrNull(row.specificHeat),
    thermalConductivity: numberOrNull(row.thermalConductivity),
    expansionCoefficient: numberOrNull(row.expansionCoefficient),
    stressStrainCurve: parseCurve(row.stressStrainCurveJson),
    fatigueCurve: parseCurve(row.fatigueCurveJson),
    fluidPoints: parseFluidTable(row.fluidTableJson),
    porousProps: parsePorous(row.porousJson),
    createdAt: row.createdAt || '',
    updatedAt: row.updatedAt || '',
    createdBy: row.createdBy || '',
    createdByDisplay: row.createdByDisplay || '',
    updatedBy: row.updatedBy || '',
    revision: Number(row.revision) > 0 ? Number(row.revision) : 1,
  };
}

/** 写入 Parquet；overwrite=false 且目标存在时抛出 code=EEXIST */
async function writeMaterialParquet(filePath, record, overwrite) {
  if (fs.existsSync(filePath) && !overwrite) {
    const err = new Error('同名记录已存在');
    err.code = 'EEXIST';
    throw err;
  }
  const tmpPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${Date.now()}.tmp`,
  );
  try {
    const writer = await ParquetWriter.openFile(materialSchema, tmpPath);
    await writer.appendRow(rowFromRecord(record));
    await writer.close();
    if (fs.existsSync(filePath)) fs.rmSync(filePath);
    fs.renameSync(tmpPath, filePath);
  } finally {
    if (fs.existsSync(tmpPath)) fs.rmSync(tmpPath, { force: true });
  }
}

async function readMaterialParquet(filePath) {
  const reader = await ParquetReader.openFile(filePath);
  try {
    const cursor = reader.getCursor();
    const row = await cursor.next();
    return recordFromRow(row);
  } finally {
    await reader.close();
  }
}

module.exports = { writeMaterialParquet, readMaterialParquet };
