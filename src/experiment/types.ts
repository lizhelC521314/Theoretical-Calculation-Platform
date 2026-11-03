/**
 * 《实验数据入库与模型校准规范》§3 数据模型（最小表）
 *
 * 八张表：experiment / measurement / theory_run / comparison /
 * case_golden / case_misfit / model_registry / audit_log。
 * measurement 按报告内的曲线组（quantity + x 序列）组织，points 即逐点测量值。
 */

/** §4 导入状态机状态 */
export type ReportStatus =
  | 'UPLOADED'
  | 'PARSED'
  | 'QC_PASSED'
  | 'QC_FAILED'
  | 'COMPARED'
  | 'GOLDEN'
  | 'MISFIT'
  | 'REVIEWED'
  | 'PUBLISHED';

/** 测量量类别：线性量（压降/力/位移）与声学量（TL/声压级）判据不同（§7） */
export type QuantityKind = 'linear' | 'acoustic';

/** §5 元数据必填项（15 项，缺任一项 → QC_FAILED） */
export interface ExperimentMeta {
  reportId: string;
  productFamily: string;
  productModel: string;
  reportVersion: string;
  testStandard: string;
  testDate: string;
  operator: string;
  lab: string;
  sensorIds: string[];
  /** 全部传感器中最早的校准到期日（ISO 日期） */
  calibrationDue: string;
  /** 温度 ℃ */
  temperature: number;
  /** 相对湿度 % */
  humidity: number;
  /** 海拔 m */
  altitude: number;
  /** 流量 m³/h */
  flowRate: number;
  /** 单位制，入库一律 'SI' */
  unitSystem: string;
}

/** 曲线点：x 为频率 Hz（声学）或工况自变量（流量等），y 为 SI 单位测量值 */
export interface CurvePoint {
  x: number;
  y: number;
}

/** measurement：一条曲线（某测量量在某工况下的一组点） */
export interface MeasurementCurve {
  /** 量名：阻力 / TL / 隔振 … */
  quantity: string;
  kind: QuantityKind;
  /** SI 单位 */
  unit: string;
  /** 主测量值序列 */
  points: CurvePoint[];
  /** 扩展不确定度 U95（与 unit 同单位），未知可缺省 */
  uncertaintyU95?: number;
  /** 重复测量：repeats[i] 为第 i 个 x 点的多次重复值（重复性 QC 用，≥3 次才判定） */
  repeats?: number[][];
}

/** experiment 表记录 */
export interface ExperimentRecord {
  reportId: string;
  status: ReportStatus;
  meta: ExperimentMeta;
  curves: MeasurementCurve[];
  /** 原始文件 SHA256（原始层只读凭证） */
  fileHash: string;
  filePath: string;
  /** QC 标记的可疑曲线（quantity 列表），对应 verdict SUSPECT */
  suspectQuantities: string[];
  createdAt: string;
}

/** theory_run：一次理论计算（与公式版本绑定，可复现） */
export interface TheoryRun {
  id: string;
  /** 模型 ID = 公式注册表 formula id */
  modelId: string;
  /** 模型版本（软件版本号） */
  modelVersion: string;
  reportId: string;
  inputJson: Record<string, number>;
  /** 标量输出或曲线输出 */
  outputJson: { scalars: Record<string, number>; curve?: { quantity: string; points: CurvePoint[] } };
  computedAt: string;
}

/** §7 比较指标 */
export interface ComparisonMetrics {
  /** 标量：实测值 / 模型值 */
  refValue?: number;
  modelValue?: number;
  /** 线性标量：相对误差 % */
  relErrPct?: number;
  /** 声学标量：|ΔdB| */
  absErrDb?: number;
  /** 曲线指标（§7：全部满足才 PASS） */
  mapePct?: number;
  rmse?: number;
  peakFreqDevPct?: number;
  bandAvgDev?: number;
}

/** 三态输出：PASS / FAIL / SUSPECT（数据质量问题，不算模型偏差） */
export type Verdict = 'PASS' | 'FAIL' | 'SUSPECT';

/** comparison 表记录 */
export interface ComparisonRecord {
  id: string;
  reportId: string;
  modelId: string;
  quantity: string;
  kind: QuantityKind;
  metrics: ComparisonMetrics;
  verdict: Verdict;
  /** 判定理由（人类可读） */
  reason: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

/** §8 misfit 根因标签 */
export type RootCause = 'boundary' | 'measurement' | 'model_missing' | 'unit';

export const ROOT_CAUSE_LABELS: Record<RootCause, string> = {
  boundary: '边界条件不符',
  measurement: '测量误差',
  model_missing: '模型缺项',
  unit: '单位错误',
};

/** case_golden：高精案例（须人工审核后才可作推荐值） */
export interface GoldenCase {
  caseId: string;
  reportId: string;
  modelId: string;
  applicableRange: string;
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
}

/** case_misfit：偏差案例（必须打根因标签） */
export interface MisfitCase {
  caseId: string;
  reportId: string;
  modelId: string;
  rootCause: RootCause;
  note: string;
  createdAt: string;
}

/** model_registry：公式版本与校准记录 */
export interface ModelRegistryEntry {
  modelId: string;
  version: string;
  coefficientsJson: Record<string, number>;
  calibrationDataIds: string[];
  metricsJson: Record<string, number>;
  status: 'draft' | 'released' | 'retired';
  createdAt: string;
}

/** audit_log：每次状态迁移与关键操作必写 */
export interface AuditEntry {
  id: string;
  entity: string;
  entityId: string;
  action: string;
  beforeJson: unknown;
  afterJson: unknown;
  actor: string;
  timestamp: string;
}
