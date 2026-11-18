/**
 * AI 公式优化 —— 标定策略与结果类型
 *
 * 依据《编织管传递损失模型参数标定算法说明》V1.0（成都万友滤机 技术中心）：
 * 策略 jca-porous-calibration/v1.1 —— 有效 1/3 倍频带、不确定度加权、Huber 稳健损失、
 * 峰值惩罚、正则化、参数归一化、多起点 Nelder-Mead、相对收敛判据、
 * JᵀJ 协方差 + 分块 bootstrap、按样件分组验证。
 */

/** 参数变换：log 保证正值（C_R）；scale 按初值缩放（A_L、B_L） */
export type ParamTransform = 'log' | 'scale';

export interface CalibParamSpec {
  key: string;
  label: string;
  /** tunable 参与优化；supplier 供应商给定；fixed 固定（可作为场景变量） */
  role: 'tunable' | 'supplier' | 'fixed';
  transform: ParamTransform;
  /** scale 变换的尺度（通常取上一版系数），log 变换忽略 */
  scale: number;
  /** 初值（上一版系数） */
  initial: number;
  min?: number;
  max?: number;
}

export interface CalibrationStrategy {
  id: string;
  version: string;
  formulaId: string;
  target: { output: string; unit: string; metric: string };
  bands: {
    /** 测试有效下限 */
    minHz: number;
    /** 测试有效上限 */
    maxHz: number;
    /** 低于该频率的频带降权（默认 100 Hz） */
    dropBelowHz: number;
    /** 频带内实测点需覆盖的最小比例 */
    minCoverage: number;
    /** 低于降权频率时的权重 */
    lowBandWeight: number;
  };
  objective: {
    /** Huber δ（dB） */
    huberDelta: number;
    /** 向初值正则的系数 λ */
    lambda: number;
    /** 峰值频率惩罚系数 λ_p */
    lambdaPeak: number;
    /** 峰值显著性阈值（dB），不足则不计峰值惩罚 */
    peakProminence: number;
  };
  optimizer: {
    engine: 'nelder-mead';
    /** 起点数（1 个上版初值 + starts-1 个 LHS） */
    starts: number;
    maxIter: number;
    /** 相对目标收敛判据 */
    tolF: number;
    /** 相对参数收敛判据 */
    tolU: number;
  };
  uncertainty: {
    jacobian: boolean;
    blockBootstrap: boolean;
    resamples: number;
    /** 每个重采样块包含的相邻频带数 */
    blockSize: number;
  };
  validation: { method: 'group-holdout' | 'none'; trainRatio: number };
  params: CalibParamSpec[];
}

export interface DatasetPoint {
  f: number;
  y: number;
}

/** 一条实测曲线 + 该曲线对应的公式输入（SI） */
export interface CalibrationDataset {
  id: string;
  formulaId: string;
  quantity: string;
  unit: string;
  inputs: Record<string, number>;
  points: DatasetPoint[];
  /** 样件/工况分组键，验证时按组划分 */
  groupId: string;
  /** 数据哈希（原始文件 SHA256） */
  hash: string;
}

export interface BandRecord {
  /** 标称中心频率 Hz */
  center: number;
  /** 带内实测点数 */
  n: number;
  /** 频带覆盖比例 0~1 */
  coverage: number;
  test: number;
  model: number;
  residual: number;
  weight: number;
  included: boolean;
  reason?: string;
}

export interface ParamEstimate {
  key: string;
  label: string;
  initial: number;
  value: number;
  stdErr: number;
  ci95: [number, number];
  ciBootstrap?: [number, number];
  /** 最优解是否贴在参数边界上（active constraint） */
  atBound: boolean;
  transform: ParamTransform;
}

export interface MultiStartSolution {
  index: number;
  J: number;
  params: Record<string, number>;
  evaluations: number;
}

export interface MetricCheck {
  key: string;
  label: string;
  value: number;
  limit: number;
  /** 是否满足：value ≤ limit */
  pass: boolean;
}

export interface Metrics {
  /** 未加权逐带 RMSE（dB） */
  rmse: number;
  /** 未加权逐带 MAE（dB） */
  mae: number;
  /** 最大单带误差（dB） */
  maxAbsBandErr: number;
  /** 峰值频率偏差（%） */
  peakFreqDevPct: number;
  /** 带内平均偏差（dB） */
  bandAvgDev: number;
  r2?: number;
  checks: MetricCheck[];
}

export interface SensitivityRow {
  fpScale: number;
  fp: number;
  params: Record<string, number>;
  rmse: number;
}

export interface CalibrationReport {
  strategy: { id: string; version: string; algorithm: string };
  formula: { id: string; version: string };
  dataset: {
    id: string;
    hash: string;
    quantity: string;
    unit: string;
    points: number;
    groupId: string;
    inputs: Record<string, number>;
  };
  bands: BandRecord[];
  excludedBands: { center: number; reason: string }[];
  objective: {
    J: number;
    huberDelta: number;
    lambda: number;
    lambdaPeak: number;
    peakPenaltyEnabled: boolean;
  };
  optimizer: {
    engine: string;
    starts: number;
    evaluations: number;
    converged: boolean;
    solutions: MultiStartSolution[];
    multiSolution: boolean;
  };
  params: ParamEstimate[];
  diagnostics: {
    correlation: number[][];
    conditionNumber: number;
    activeConstraints: string[];
  };
  metrics: Metrics;
  validation: {
    method: string;
    status: 'calibrated-only' | 'validated';
    note: string;
    trainRmse?: number;
    holdoutRmse?: number;
  };
  sensitivity: SensitivityRow[];
  warnings: string[];
  createdAt: string;
}

/** 模型求值：输入（SI）+ 参数 → 指定频率上的 TL */
export type ModelEval = (
  inputs: Record<string, number>,
  params: Record<string, number>,
  freqs: number[],
) => number[];

/* ---------------- 标定记录（草稿 → 审核 → 发布） ---------------- */

/**
 * draft：刚跑完，可编辑后重算
 * reviewed：已人工审核，可发布
 * released：已发布，软件计算使用该组系数（同一公式只允许一个）
 * archived：被新版本替换
 * rejected：审核未通过
 */
export type CalibrationRecordStatus = 'draft' | 'reviewed' | 'released' | 'archived' | 'rejected';

export interface CalibrationGeometry {
  /** 内径 mm */
  D: number;
  /** 长度 mm */
  L: number;
  /** 壁厚 mm */
  t: number;
  /** 孔隙度 Hz */
  fp: number;
}

export interface CalibrationRecord {
  id: string;
  formulaId: string;
  formulaVersion: string;
  strategyId: string;
  strategyVersion: string;
  datasetId: string;
  datasetHash: string;
  /** 数据来源：实验库已入库曲线 / 导入 Excel */
  source: 'lab' | 'xlsx';
  geometry: CalibrationGeometry;
  /** 拟合使用的公式输入（SI） */
  inputs: Record<string, number>;
  params: ParamEstimate[];
  metrics: Metrics;
  warnings: string[];
  report: CalibrationReport;
  note: string;
  status: CalibrationRecordStatus;
  createdBy: string;
  createdAt: string;
  reviewedBy?: string;
  reviewedAt?: string;
  releasedBy?: string;
  releasedAt?: string;
}
