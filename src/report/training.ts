/**
 * 培训资料数据模型
 *
 * 存放目录：\\10.1.1.245\Knowledge & Experience Base\Training
 * 一条培训资料 = 一个 PDF（统一格式）+ 一个同名 JSON（资料名、培训人、培训时间等元数据）
 * 文件编号：TR-年份-序号，如 TR-2026-001.pdf / TR-2026-001.json
 *
 * 导入时的命名建议：培训时间_培训人_资料名.pdf
 * 例如：2026-05-12_张三_空滤器设计规范.pptx
 * 系统会自动识别日期、培训人与资料名，并允许导入前手工修正。
 */

export const TRAINING_SCHEMA = 'ctr-training-v1';

export interface TrainingRecord {
  schema: string;
  id: string;
  /** 培训资料名 */
  title: string;
  /** 培训人 */
  trainer: string;
  /** 培训时间（YYYY-MM-DD） */
  trainedAt: string;
  /** 培训资料类别（CAE分析 / 产品设计 / 软件操作 / 工艺 / 材料 / 模具） */
  category: string;
  /** 原始文件名 */
  sourceName: string;
  /** 原始格式（pdf/docx/pptx/xlsx…） */
  sourceFormat: string;
  /** 归档 PDF 文件名 */
  pdfName: string;
  createdAt: string;
  createdBy: string;
  createdByDisplay: string;
  /** 由主进程列表接口补充 */
  pdfPath?: string;
  pdfExists?: boolean;
}

/** 导入时允许编辑的三项元数据 */
export interface TrainingDraft {
  title: string;
  trainer: string;
  trainedAt: string;
}

/** 培训资料类别（固定字典，导入时选择） */
export const TRAINING_CATEGORIES = ['CAE分析', '产品设计', '软件操作', '工艺', '材料', '模具'];

/** 支持的资料格式 */
export const TRAINING_ACCEPT = '.pdf,.doc,.docx,.rtf,.ppt,.pptx,.pps,.ppsx,.xls,.xlsx,.xlsm';

const DATE_PATTERN = /(20\d{2})\s*[年\-_.\/]?\s*(\d{1,2})\s*[月\-_.\/]?\s*(\d{1,2})\s*日?/;

/** 从文本中识别日期并规范为 YYYY-MM-DD；识别不到返回空串 */
export function normalizeTrainingDate(text: string): string {
  const m = String(text || '').match(DATE_PATTERN);
  if (!m) return '';
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return '';
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** 姓名特征：2~4 个汉字，且不是常见资料标题词 */
function isPersonName(segment: string): boolean {
  if (!/^[\u4e00-\u9fa5]{2,4}$/.test(segment)) return false;
  return !/(培训|资料|课程|教材|课件|讲义|手册|规范|设计|开发|管理|技术|分析|计算|标准|流程|要求|介绍|基础|进阶)/.test(
    segment,
  );
}

/**
 * 从文件名识别资料名、培训人、培训时间。
 * 约定：培训时间_培训人_资料名（顺序可换，分隔符支持 _ - 空格 等）。
 */
export function parseTrainingFileName(fileName: string): TrainingDraft {
  const base = String(fileName || '')
    .replace(/\.[^.]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!base) return { title: '', trainer: '', trainedAt: '' };

  const trainedAt = normalizeTrainingDate(base);
  const rest = base.replace(DATE_PATTERN, ' ').replace(/[年月日]/g, ' ');
  const parts = rest
    .split(/[_\-—–·|,，、/\\]+|\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (parts.length <= 1) {
    return { title: parts[0] || base, trainer: '', trainedAt };
  }

  const person = parts.find(isPersonName) || '';
  const title = parts.filter((p) => p !== person).join(' ').trim();
  return {
    title: title || base,
    trainer: person,
    trainedAt,
  };
}

/** 从封面文字中识别出的元数据 */
export interface TrainingCoverMeta {
  trainer: string;
  trainedAt: string;
}

/** 封面上常见的培训人标签（按优先级排列，长词在前避免被短词截断） */
const TRAINER_LABELS = [
  '培训讲师',
  '培训教师',
  '培训老师',
  '授课教师',
  '授课老师',
  '主讲师',
  '主讲人',
  '汇报人',
  '讲解人',
  '培训人',
  '培训师',
  '授课人',
  '讲师',
  '主讲',
];
const TRAINER_LINE_RE = new RegExp(`(${TRAINER_LABELS.join('|')})\\s*[：:]?\\s*(.*)$`);

/** 姓名：2~4 个汉字，或 1~3 个英文单词；要求在后接空格/标点/结尾处结束，避免吞掉职务 */
const COVER_NAME_RE =
  /^([\u4e00-\u9fa5]{2,4}|[A-Za-z][A-Za-z.]*(?:\s+[A-Za-z][A-Za-z.]*){0,2})(?=$|[\s·,，、|/（(；;])/;

/** 封面上常见的培训时间标签 */
const COVER_DATE_LABEL_RE =
  /(培训时间|培训日期|授课时间|授课日期|培训日|时间|日期)\s*[：:]?\s*(.{0,24})/;

function nameFromCoverText(text: string): string {
  const m = String(text || '').trim().match(COVER_NAME_RE);
  return m ? m[1].replace(/\s+/g, ' ').trim() : '';
}

/**
 * 从资料封面文字中识别培训人与培训时间。
 * 优先识别「培训人：张三」「讲师 李四」等带标签的内容，标签后换行的独立姓名也可识别；
 * 时间优先取「培训时间：2026年5月12日」等带标签的日期，识别不到再取封面第一个完整日期。
 */
export function parseTrainingCoverText(text: string): TrainingCoverMeta {
  const raw = String(text || '').replace(/\r/g, '');
  const lines = raw
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  let trainer = '';
  for (let i = 0; i < lines.length && !trainer; i++) {
    const m = lines[i].match(TRAINER_LINE_RE);
    if (!m) continue;
    trainer = nameFromCoverText(m[2]);
    // 标签与姓名分处两行（常见于 PPT 封面）
    if (!trainer && i + 1 < lines.length) trainer = nameFromCoverText(lines[i + 1]);
  }

  let trainedAt = '';
  for (const line of lines) {
    const m = line.match(COVER_DATE_LABEL_RE);
    if (!m) continue;
    trainedAt = normalizeTrainingDate(m[2]) || normalizeTrainingDate(line);
    if (trainedAt) break;
  }
  if (!trainedAt) trainedAt = normalizeTrainingDate(raw);

  return { trainer, trainedAt };
}

/** 今天（本地时区）：用于导入表单默认培训时间 */
export function todayTrainingDate(): string {
  const d = new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}
