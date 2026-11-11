/**
 * 知识理论数据模型
 *
 * 存放目录：\\10.1.1.245\Knowledge & Experience Base\Theoretical Knowledge Base
 * 一条知识理论 = 一个 PDF（统一格式）+ 一个同名 JSON（资料名、作者、日期、类别等元数据）
 * 文件编号：TH-年份-序号，如 TH-2026-001.pdf / TH-2026-001.json
 *
 * 支持导入 PPT / Word / PDF，入库时统一转为 PDF。
 */

export const THEORY_SCHEMA = 'ctr-theory-v1';

export interface TheoryRecord {
  schema: string;
  id: string;
  /** 资料名 */
  title: string;
  /** 作者 */
  author: string;
  /** 日期（YYYY-MM-DD） */
  publishedAt: string;
  /** 理论类别（结构 / 流体 / NVH / 热力学 / 通用理论） */
  category: string;
  /** 原始文件名 */
  sourceName: string;
  /** 原始格式（pdf/docx/pptx…） */
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

/** 导入 / 编辑时允许修改的元数据 */
export interface TheoryDraft {
  title: string;
  author: string;
  publishedAt: string;
  category: string;
}

/** 知识理论类别（固定字典） */
export const THEORY_CATEGORIES = ['结构', '流体', 'NVH', '热力学', '通用理论'];

/** 支持的资料格式 */
export const THEORY_ACCEPT = '.pdf,.doc,.docx,.rtf,.ppt,.pptx,.pps,.ppsx';

const DATE_PATTERN = /(20\d{2})\s*[年\-_.\/]?\s*(\d{1,2})\s*[月\-_.\/]?\s*(\d{1,2})\s*日?/;

/** 从文本中识别日期并规范为 YYYY-MM-DD；识别不到返回空串 */
export function normalizeTheoryDate(text: string): string {
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
  return !/(结构|流体|NVH|声|声学|热力学|通用|理论|分析|设计|计算|规范|手册|标准|资料|文档|课件|讲义|研究|方法|基础|应用)/.test(
    segment,
  );
}

/** 从资料名猜测类别（命中即返回，识别不到返回空串由用户选择） */
export function guessTheoryCategory(text: string): string {
  const t = String(text || '');
  if (/热|温度|散热|热管理/.test(t)) return '热力学';
  if (/声|噪声|噪音|声学|NVH/i.test(t)) return 'NVH';
  if (/流|气动|风量|阻力|压降|CFD/i.test(t)) return '流体';
  if (/结构|强度|刚度|模态|疲劳|振动/.test(t)) return '结构';
  if (/通用|基础|概论|综述/.test(t)) return '通用理论';
  return '';
}

/**
 * 从文件名识别资料名、作者、日期。
 * 约定：日期_作者_资料名（顺序可换，分隔符支持 _ - 空格 等）。
 */
export function parseTheoryFileName(fileName: string): TheoryDraft {
  const base = String(fileName || '')
    .replace(/\.[^.]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!base) return { title: '', author: '', publishedAt: '', category: '' };

  const publishedAt = normalizeTheoryDate(base);
  const rest = base.replace(DATE_PATTERN, ' ').replace(/[年月日]/g, ' ');
  const parts = rest
    .split(/[_\-—–·|,，、/\\]+|\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (parts.length <= 1) {
    return { title: parts[0] || base, author: '', publishedAt, category: guessTheoryCategory(base) };
  }

  const person = parts.find(isPersonName) || '';
  const title = parts.filter((p) => p !== person).join(' ').trim();
  return {
    title: title || base,
    author: person,
    publishedAt,
    category: guessTheoryCategory(base),
  };
}

/** 今天（本地时区）：用于导入表单默认日期 */
export function todayTheoryDate(): string {
  const d = new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}
