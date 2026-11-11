/**
 * 知识经验库·四类资料（标准&规范 / 设计指南 / 经验教训 / 论文专利）
 *
 * 存放目录：\\10.1.1.245\Knowledge & Experience Base\<分类目录>
 * 一条资料 = 一个 PDF（统一格式）+ 一个同名 JSON（元数据），与知识理论库一致。
 * 文件编号按分类分前缀：STD-年份-序号 / GDL / LL / PT。
 *
 * 支持导入 PPT / Word / PDF，入库时统一转为 PDF。
 */
import { parseTheoryFileName } from './theory';

export const KBE_DOC_SCHEMA = 'ctr-kbe-doc-v1';

export type KbeDocCategory = 'standards' | 'guidelines' | 'lessons' | 'papers';

export interface KbeDocRecord {
  schema: string;
  id: string;
  /** 所属分类（与目录一一对应） */
  category: KbeDocCategory;
  /** 资料名 / 标准名 */
  title: string;
  /** 作者 / 编制单位 / 发布单位 */
  author: string;
  /** 日期（YYYY-MM-DD） */
  publishedAt: string;
  /** 资料细分类别，取自该分类的字典 */
  docCategory: string;
  /** 分类专属字段（标准号、实施日期、严重度等），键见 KBE_DOCS[category].fields */
  extras: Record<string, string>;
  sourceName: string;
  sourceFormat: string;
  pdfName: string;
  createdAt: string;
  createdBy: string;
  createdByDisplay: string;
  updatedAt?: string;
  /** 由主进程列表接口补充 */
  pdfPath?: string;
  pdfExists?: boolean;
}

export interface KbeDocDraft {
  title: string;
  author: string;
  publishedAt: string;
  docCategory: string;
  extras: Record<string, string>;
}

/** 分类专属字段：有 options 渲染下拉，type=date 渲染日期选择 */
export interface KbeFieldDef {
  key: string;
  label: string;
  placeholder?: string;
  options?: string[];
  type?: 'text' | 'date';
  /** 是否作为列表徽标展示（如标准状态、严重度） */
  badge?: boolean;
  /** 是否在导入行直接出现（如标准的业务领域），避免入库后再补录 */
  importInRow?: boolean;
  /** 是否在列表工具栏提供该字段的筛选下拉 */
  filterInList?: boolean;
}

export interface KbeDocConfig {
  key: KbeDocCategory;
  /** 导航与页面标题 */
  label: string;
  /** 共享目录名（位于 Knowledge & Experience Base 下） */
  dirName: string;
  /** 编号前缀 */
  idPrefix: string;
  /** 细分类别字典 */
  kinds: string[];
  /** 分类专属字段（导入后在详情区补录，可参与检索） */
  fields: KbeFieldDef[];
  /** 导入表单提示 */
  titleHint: string;
  authorLabel: string;
}

export const KBE_DOCS: Record<KbeDocCategory, KbeDocConfig> = {
  standards: {
    key: 'standards',
    label: '标准&规范',
    dirName: 'Standards & Specifications',
    idPrefix: 'STD',
    kinds: ['国家标准', '行业标准', '企业标准', '法规/认证'],
    fields: [
      { key: 'stdNo', label: '标准号', placeholder: 'GB/T 28949-2025' },
      { key: 'issuer', label: '发布机构', placeholder: '国家标准化管理委员会' },
      { key: 'status', label: '标准状态', options: ['现行', '即将实施', '征求意见', '作废'], badge: true },
      {
        key: 'domain',
        label: '业务领域',
        options: ['产品设计', '包装设计', '试验测试', '环保要求'],
        badge: true,
        importInRow: true,
        filterInList: true,
      },
      { key: 'effectiveAt', label: '实施日期', type: 'date' },
      { key: 'replaced', label: '代替 / 被代替', placeholder: '代替 GB/T 28949-2014' },
      { key: 'scope', label: '适用范围', placeholder: '如 内燃机空气滤清器性能试验' },
    ],
    titleHint: '如 GB/T 28949-2025 内燃机空气滤清器',
    authorLabel: '发布单位',
  },
  guidelines: {
    key: 'guidelines',
    label: '设计指南',
    dirName: 'Design Guidelines',
    idPrefix: 'GDL',
    kinds: ['设计指南', '选型指南', '设计手册', '流程规范'],
    fields: [
      { key: 'version', label: '版本', placeholder: 'V1.0' },
      { key: 'owner', label: '归口部门', placeholder: '如 研发中心 · 结构设计' },
      { key: 'stage', label: '适用阶段', options: ['概念设计', '详细设计', '仿真验证', '试验验证', '量产'], badge: true },
      { key: 'scope', label: '适用范围', placeholder: '如 进气系统滤芯选型' },
    ],
    titleHint: '如 进气系统流阻设计指南',
    authorLabel: '编制人 / 部门',
  },
  lessons: {
    key: 'lessons',
    label: '经验教训',
    dirName: 'Lessons Learned',
    idPrefix: 'LL',
    kinds: ['质量问题', '失效案例', '工艺问题', '客户反馈'],
    fields: [
      { key: 'project', label: '关联项目 / 产品', placeholder: '如 长安 CS75-2025' },
      { key: 'severity', label: '严重度', options: ['高', '中', '低'], badge: true },
      { key: 'status', label: '处理状态', options: ['待评估', '整改中', '已关闭'], badge: true },
      { key: 'rootCause', label: '根因分类', options: ['设计', '工艺', '材料', '供应链', '使用'] },
    ],
    titleHint: '如 滤芯端盖脱胶导致压降异常',
    authorLabel: '记录人',
  },
  papers: {
    key: 'papers',
    label: '论文/专利',
    dirName: 'Papers Patents',
    idPrefix: 'PT',
    kinds: ['技术论文', '专利', '会议论文', '技术报告'],
    fields: [
      { key: 'source', label: '期刊 / 会议 / 专利号', placeholder: '如 SAE 2025-01-0123' },
      { key: 'doi', label: 'DOI / 公开号', placeholder: '如 10.4271/2025-01-0123' },
      { key: 'inventor', label: '作者 / 发明人', placeholder: '第一作者或发明人' },
    ],
    titleHint: '如 褶皱滤芯压降的试验与仿真对比',
    authorLabel: '作者 / 发明人',
  },
};

export function kbeDocConfig(key: KbeDocCategory): KbeDocConfig {
  return KBE_DOCS[key];
}

/** 支持的资料格式（与知识理论库一致） */
export const KBE_DOC_ACCEPT = '.pdf,.doc,.docx,.rtf,.ppt,.pptx,.pps,.ppsx';

/** 从文件名识别资料名、作者与日期；顺带识别标准号（如 GB/T 28949-2025） */
export function parseKbeDocFileName(fileName: string): KbeDocDraft {
  const parsed = parseTheoryFileName(fileName);
  const extras: Record<string, string> = {};
  const std = fileName.match(/([A-Z]{2,6}\s*\/?\s*[A-Z]{1,3}\s*\d+(?:\.\d+)?\s*[-—]\s*\d{4})/);
  if (std) {
    const raw = std[1].replace(/\s+/g, ' ').trim();
    // 「GB/T」「QC T」两种写法统一成带斜杠的标准号前缀
    extras.stdNo = raw.replace(/^([A-Z]+)\s*\/?\s*([A-Z]{1,3})\s+/, '$1/$2 ');
  }
  return {
    title: parsed.title,
    author: parsed.author,
    publishedAt: parsed.publishedAt,
    docCategory: '',
    extras,
  };
}

/** 按文件名推断细分类别；识别不出返回空串，由用户在导入行或详情区选择 */
export function inferKbeDocCategory(fileName: string, category: KbeDocCategory): string {
  const name = fileName.toUpperCase();
  if (category === 'standards') {
    if (/(^|[^A-Z])(GB\/?\s*T?|GBZ)\s*\d/.test(name)) return '国家标准';
    if (/(QC|JB|HG|AQ|YY)\/?\s*T\s*\d/.test(name)) return '行业标准';
    if (/企标|Q\/[A-Z]{2,}\s*\d/.test(name)) return '企业标准';
    if (/(ISO|IEC|SAE|DIN|JIS|ASTM|EN|VDA|ECE|FMVSS)\s*[\d/]/.test(name)) return '法规/认证';
    return '';
  }
  if (category === 'guidelines') {
    if (/选型/.test(fileName)) return '选型指南';
    if (/手册/.test(fileName)) return '设计手册';
    if (/流程|规范/.test(fileName)) return '流程规范';
    if (/指南/.test(fileName)) return '设计指南';
    return '';
  }
  if (category === 'lessons') {
    if (/失效|故障|断裂|开裂|磨损|烧蚀/.test(fileName)) return '失效案例';
    if (/客诉|客户|抱怨|反馈/.test(fileName)) return '客户反馈';
    if (/工艺|装配|焊接|注塑|成型/.test(fileName)) return '工艺问题';
    if (/质量|不合格|缺陷|偏差/.test(fileName)) return '质量问题';
    return '';
  }
  if (/专利|公开号|CN\d{6,}/.test(name)) return '专利';
  if (/会议|CONFERENCE|SYMPOSIUM|PROCEEDINGS/.test(name)) return '会议论文';
  if (/报告|REPORT/.test(name)) return '技术报告';
  if (/论文|JOURNAL|DOI|TRANSACTIONS/.test(name)) return '技术论文';
  return '';
}

export function todayKbeDocDate(): string {
  const d = new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}
