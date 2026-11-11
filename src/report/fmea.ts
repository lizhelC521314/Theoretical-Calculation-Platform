/**
 * FMEA库数据模型
 *
 * 存放目录：\\10.1.1.245\Knowledge & Experience Base\FMEA Library
 * 一条 FMEA 记录 = 一张知识卡片 = 一个 .parquet 文件，文件名即编号：FM-2026-001.parquet
 *
 * 字段沿用技术中心《FMEA 案例收集》表格：
 *   机种名称 / 部件名称 / 本体使用材料 / 潜在的失效模式 / 失效模式图片
 *   潜在的失效后果 / 潜在的失效起因·机理 / 建议的措施 / 措施对策图片 / 备注
 *   责任人 / 记录时间
 * 另加平台字段：编号、来源工作表、录入人、版本、复用次数，便于检索与追溯。
 */

import { cleanFileName } from './db';

export const FMEA_SCHEMA = 'ctr-fmea-v1';

/** 风险等级：历史案例没有 S/O/D 时按定性规则给出高/中/低 */
export type RiskLevel = '' | '高' | '中' | '低';
export const RISK_LEVELS: RiskLevel[] = ['高', '中', '低'];

/** 系统类别（固定值 + 自定义输入） */
export const FMEA_SYSTEM_OPTIONS = ['进气系统', '热管理系统', '自定义'];

/** 受控字典：失效分类 / 原因分类 / 措施类型 / 验证状态 */
export const FAILURE_CATEGORIES = ['开裂', '断裂', '变形', '脱落', '泄漏', '堵塞', '异响', '磨损', '外观', '尺寸', '功能', '其他'];
export const CAUSE_CATEGORIES = ['设计', '材料', '工艺', '装配', '使用', '其他'];
export const MEASURE_TYPES = ['设计', '材料', '工艺', '检测'];
export const VERIFY_STATUSES = ['未验证', '已验证', '已验证有效'];

/* ============ 三维分类字典（产品维 / 失效模式维 / 原因维） ============ */

export interface FmeaMinorClass {
  code: string;
  name: string;
  re: RegExp;
}

export interface FmeaMajorClass {
  code: string;
  name: string;
  re: RegExp;
  minors: FmeaMinorClass[];
}

/** 产品维：大类 A~J、小类编码（编码只增不改） */
export const PRODUCT_CLASSES: FmeaMajorClass[] = [
  {
    code: 'A', name: '空气滤清器总成', re: /空滤器|空气滤清器|空滤/,
    minors: [
      { code: 'A01', name: '上壳体', re: /上壳体|上盖|上壳/ },
      { code: 'A02', name: '下壳体', re: /下壳体|下盖|下壳/ },
      { code: 'A03', name: '滤芯总成', re: /滤芯总成/ },
      { code: 'A04', name: '密封圈/密封条', re: /密封圈|密封条/ },
      { code: 'A05', name: '卡扣/锁扣', re: /锁扣/ },
      { code: 'A06', name: '进气口/出气口', re: /出气口/ },
      { code: 'A07', name: '排水阀', re: /排水阀/ },
      { code: 'A08', name: '预滤/旋风分离', re: /旋风/ },
      { code: 'A09', name: '消声腔', re: /消声腔/ },
      { code: 'A10', name: '安装支架', re: /安装支架/ },
      { code: 'A11', name: '传感器座', re: /传感器座/ },
      { code: 'A12', name: '灰滤器/预滤器', re: /灰滤|预滤/ },
    ],
  },
  {
    code: 'B', name: '进气管道系统', re: /进气管道|管道|管路/,
    minors: [
      { code: 'B01', name: '脏管', re: /脏管|脏侧/ },
      { code: 'B02', name: '干净管', re: /干净管|洁净管|净管/ },
      { code: 'B03', name: '进气管', re: /进气管|进气软管/ },
      { code: 'B04', name: '出气管', re: /出气管/ },
      { code: 'B05', name: '波纹管', re: /波纹管|波纹/ },
      { code: 'B06', name: '变径管', re: /变径/ },
      { code: 'B07', name: '三通/分支', re: /三通|分支/ },
      { code: 'B08', name: '快插接头', re: /快插/ },
      { code: 'B09', name: '抱箍/卡箍', re: /抱箍|卡箍/ },
      { code: 'B10', name: '隔热罩', re: /隔热罩/ },
      { code: 'B11', name: '管道支架', re: /管道支架|管支架/ },
    ],
  },
  {
    code: 'C', name: '进气口与防护', re: /进气口|防护/,
    minors: [
      { code: 'C01', name: '进气口本体', re: /进气口/ },
      { code: 'C02', name: '格栅', re: /格栅/ },
      { code: 'C03', name: '雪挡/防雪罩', re: /雪挡|防雪/ },
      { code: 'C04', name: '涉水喉', re: /涉水喉/ },
      { code: 'C05', name: '排水结构', re: /排水口|排水结构/ },
      { code: 'C06', name: '防尘罩/预滤', re: /防尘罩/ },
    ],
  },
  {
    code: 'D', name: '消声与谐振', re: /消声|消音|谐振/,
    minors: [
      { code: 'D01', name: 'Helmholtz 谐振腔', re: /谐振腔|赫姆霍兹|helmholtz/i },
      { code: 'D02', name: '四分之一波长管', re: /波长管/ },
      { code: 'D03', name: '多腔消声器', re: /消声器|消音器/ },
      { code: 'D04', name: '穿孔板/吸声棉', re: /穿孔板|吸声棉/ },
      { code: 'D05', name: '消声器壳体', re: /消声器壳/ },
    ],
  },
  {
    code: 'E', name: '滤芯与过滤介质', re: /滤芯|过滤介质/,
    minors: [
      { code: 'E01', name: '滤纸', re: /滤纸/ },
      { code: 'E02', name: '无纺布', re: /无纺布/ },
      { code: 'E03', name: '端盖', re: /端盖/ },
      { code: 'E04', name: '骨架/网板', re: /骨架|网板/ },
      { code: 'E05', name: '密封条', re: /密封条/ },
      { code: 'E06', name: '滤芯总成', re: /滤芯/ },
    ],
  },
  {
    code: 'F', name: '密封、连接与固定', re: /密封|连接|固定/,
    minors: [
      { code: 'F01', name: 'O 形圈', re: /o\s*形圈|o-ring/i },
      { code: 'F02', name: '异形密封', re: /异形密封/ },
      { code: 'F03', name: '卡扣', re: /卡扣/ },
      { code: 'F04', name: '快插', re: /快插/ },
      { code: 'F05', name: '抱箍', re: /抱箍|卡箍/ },
      { code: 'F06', name: '螺纹/嵌件', re: /螺纹|嵌件|螺栓|螺钉/ },
      { code: 'F07', name: '支架/缓冲垫', re: /支架|缓冲垫/ },
    ],
  },
  {
    code: 'G', name: 'PCV/EGR/增压管路', re: /pcv|egr|增压|中冷/i,
    minors: [
      { code: 'G01', name: 'PCV 管路', re: /pcv/i },
      { code: 'G02', name: 'EGR 转接管', re: /egr/i },
      { code: 'G03', name: '增压/中冷管路', re: /增压|中冷|涡轮/ },
      { code: 'G04', name: '混合阀壳体', re: /混合阀/ },
    ],
  },
  {
    code: 'H', name: '新能源进气与气体处理', re: /新能源|吸附|增湿/,
    minors: [
      { code: 'H01', name: 'FCV 吸附模块', re: /fcv|吸附/i },
      { code: 'H02', name: '水汽分离', re: /水汽分离|水分离/ },
      { code: 'H03', name: '去离子器', re: /去离子/ },
      { code: 'H04', name: '增湿器接口', re: /增湿/ },
    ],
  },
  {
    code: 'I', name: '传感器/加热/附件', re: /传感器|加热|线束/,
    minors: [
      { code: 'I01', name: 'MAF/MAP 传感器座', re: /maf|map|流量传感器/i },
      { code: 'I02', name: '温度/压力传感器', re: /温度传感器|压力传感器/ },
      { code: 'I03', name: '加热器', re: /加热器|加热/ },
      { code: 'I04', name: '线束固定', re: /线束/ },
    ],
  },
  {
    code: 'J', name: '热管理与油滤（扩展）', re: /水路|油滤|吸滤/,
    minors: [
      { code: 'J01', name: '水路板', re: /水路板/ },
      { code: 'J02', name: '流道板', re: /流道板/ },
      { code: 'J03', name: '电机机油滤', re: /机油滤|机滤/ },
      { code: 'J04', name: '吸滤器', re: /吸滤/ },
    ],
  },
];

/** 失效模式维：F01~F18 */
export const FAILURE_CODES: Array<{ code: string; name: string; re: RegExp }> = [
  { code: 'F01', name: '开裂/断裂', re: /开裂|裂纹|裂缝|龟裂|断裂|折断|脆断/ },
  { code: 'F02', name: '泄漏/密封失效', re: /泄漏|漏气|漏油|渗漏|泄露|渗油/ },
  { code: 'F03', name: '变形/翘曲', re: /变形|翘曲|扭曲|凹陷/ },
  { code: 'F04', name: '脱落/松脱/分离', re: /脱落|脱开|松脱|掉落|脱胶|分离/ },
  { code: 'F05', name: '堵塞/流通不足', re: /堵塞|阻塞|堵死|流通不足|压差高/ },
  { code: 'F06', name: '异响/噪声/啸叫', re: /异响|噪声|噪音|啸叫/ },
  { code: 'F07', name: '磨损/磨蚀', re: /磨损|磨蚀|磨穿|刮擦/ },
  { code: 'F08', name: '外观缺陷', re: /外观|缩痕|飞边|毛刺|色差|喷霜|划伤/ },
  { code: 'F09', name: '尺寸/装配干涉', re: /尺寸|超差|公差|装配干涉|干涉/ },
  { code: 'F10', name: '功能/性能不足', re: /性能不足|效率不足|过滤效率|流阻|消声量|分离效率/ },
  { code: 'F11', name: '老化/腐蚀/水解', re: /老化|腐蚀|水解/ },
  { code: 'F12', name: '振动疲劳', re: /振动疲劳|疲劳断裂|疲劳开裂|交变载荷/ },
  { code: 'F13', name: '焊接/粘接失效', re: /焊接失效|焊缝|脱焊|粘接失效|胶接|热板焊/ },
  { code: 'F14', name: '插接/连接失效', re: /插接|快插失效|抱箍松脱|螺纹失效|连接失效/ },
  { code: 'F15', name: '结冰/冷凝/吸水', re: /结冰|冷凝|吸水|进水/ },
  { code: 'F16', name: '污染/异物', re: /污染|异物|粉尘|颗粒/ },
  { code: 'F17', name: '电气/传感器失效', re: /电气|传感器|信号|断路|短路/ },
  { code: 'F18', name: '热变形/热老化', re: /热变形|热老化|高温变形|受热变形/ },
];

/** 原因维：设计 D / 材料 M / 工艺 P / 制造 Mf + 细类 */
export const CAUSE_CODES: Array<{ code: string; name: string; re: RegExp }> = [
  { code: 'D01', name: '强度/刚度不足', re: /强度|刚度|应力/ },
  { code: 'D02', name: '圆角/壁厚/过渡不当', re: /圆角|壁厚|过渡|突变/ },
  { code: 'D03', name: '卡扣/锁止设计不当', re: /卡扣|锁止|倒扣/ },
  { code: 'D04', name: '密封槽/压缩量不当', re: /密封槽|压缩量|压缩率/ },
  { code: 'D05', name: '公差链/间隙不当', re: /公差|间隙|面差|尺寸链/ },
  { code: 'D06', name: '流道/截面/排水不当', re: /流道|截面|排水/ },
  { code: 'D07', name: '消声腔/模态不当', re: /消声腔|模态|共振|腔体|频率/ },
  { code: 'D08', name: '材料选型不当', re: /选型|选材/ },
  { code: 'D09', name: '防错/装配导向不足', re: /防错|装配导向|导向|盲装/ },
  { code: 'D10', name: '热/振动/疲劳考虑不足', re: /热膨胀|振动|疲劳/ },
  { code: 'D11', name: '防尘/防水/防冰不足', re: /防尘|防水|防冰|涉水|密封等级/ },
  { code: 'D12', name: '进气口布置不合理', re: /进气口.*(布置|位置|朝向|方向|高度)|(布置|位置|朝向|方向).*进气口/ },
  { code: 'M01', name: '牌号/等级选错', re: /牌号|等级选/ },
  { code: 'M02', name: '玻纤含量/取向/分布', re: /玻纤|玻璃纤维/ },
  { code: 'M03', name: '耐温/耐油/耐水解不足', re: /耐温|耐油|耐水解/ },
  { code: 'M04', name: '耐候/耐 UV 不足', re: /耐候|uv|紫外/i },
  { code: 'M05', name: '吸湿/喷霜/相容性', re: /吸湿|喷霜|相容/ },
  { code: 'M06', name: '回料/批次波动', re: /回料/ },
  { code: 'M07', name: '密封材料压缩永久变形', re: /压缩永久变形|永久变形/ },
  { code: 'M08', name: '滤纸克重/透气度/挺度', re: /克重|透气度|挺度/ },
  { code: 'M09', name: '金属腐蚀/镀层', re: /腐蚀|镀层/ },
  { code: 'P01', name: '注塑温度/压力/保压/冷却', re: /注塑|保压|冷却/ },
  { code: 'P02', name: '焊接参数', re: /焊接|热板焊|超声焊|激光焊|振动焊/ },
  { code: 'P03', name: '粘接/胶量/固化', re: /粘接|胶量|固化|点胶/ },
  { code: 'P04', name: '装配顺序/扭矩/压装', re: /装配|扭矩|压装|拧紧/ },
  { code: 'P05', name: '热处理/退火/表面处理', re: /热处理|退火|表面处理/ },
  { code: 'P06', name: '清洗/包装/防护', re: /清洗|包装/ },
  { code: 'P07', name: '工装夹具/定位', re: /工装|夹具|定位/ },
  { code: 'P08', name: '模具温度/排气/浇口', re: /模具温度|排气|浇口/ },
  { code: 'Mf01', name: '设备精度/磨损', re: /设备精度|设备磨损|设备/ },
  { code: 'Mf02', name: '模具磨损/维修', re: /模具磨损|模具维修/ },
  { code: 'Mf03', name: '尺寸偏差/飞边/毛刺', re: /尺寸偏差|飞边|毛刺/ },
  { code: 'Mf04', name: '缩痕/熔接痕/流痕', re: /缩痕|熔接痕|流痕/ },
  { code: 'Mf05', name: '错位/缺料/混料', re: /错位|缺料|混料/ },
  { code: 'Mf06', name: '污染/异物/洁净度', re: /污染|异物|洁净度/ },
  { code: 'Mf07', name: '人为操作/漏工序', re: /人为|漏工序|操作不当/ },
  { code: 'Mf08', name: '批次一致性/来料批次', re: /批次一致性|来料批次/ },
  { code: 'Mf09', name: '环境温湿度', re: /环境温|温湿度/ },
];

/** 匹配优先级：先具体现象，再通用现象 */
const FAILURE_MATCH_ORDER = ['F18', 'F17', 'F14', 'F13', 'F12', 'F11', 'F16', 'F15', 'F10', 'F09', 'F08', 'F07', 'F06', 'F05', 'F04', 'F03', 'F02', 'F01'];

/** 匹配优先级：先设计（判断责任更具体），再材料、工艺、制造 */
const CAUSE_MATCH_ORDER = [
  'D03', 'D04', 'D06', 'D12', 'D07', 'D08', 'D09', 'D10', 'D11', 'D01', 'D02', 'D05',
  'M07', 'M08', 'M09', 'M03', 'M04', 'M05', 'M06', 'M02', 'M01',
  'P02', 'P03', 'P01', 'P04', 'P05', 'P06', 'P07', 'P08',
  'Mf01', 'Mf02', 'Mf03', 'Mf04', 'Mf05', 'Mf06', 'Mf07', 'Mf08', 'Mf09',
];

/** 产品大类下拉选项（值形如「A 空气滤清器总成」） */
export function productMajorOptions(): string[] {
  return PRODUCT_CLASSES.map((m) => `${m.code} ${m.name}`);
}

/** 产品小类下拉选项（值形如「A01 上壳体」） */
export function productMinorOptions(): string[] {
  return PRODUCT_CLASSES.flatMap((m) => m.minors.map((x) => `${x.code} ${x.name}`));
}

/** 失效模式编码下拉选项 */
export function failureCodeOptions(): string[] {
  return FAILURE_CODES.map((f) => `${f.code} ${f.name}`);
}

/** 原因编码下拉选项（含四个原因大类兜底项） */
export function causeCodeOptions(): string[] {
  return ['D 设计', 'M 材料', 'P 工艺', 'Mf 制造', ...CAUSE_CODES.map((c) => `${c.code} ${c.name}`)];
}

/** 取编码值的前缀（A01 / F01 / D03 / Mf04） */
export function classCode(value: string): string {
  const m = String(value || '').match(/^([A-J]|F\d{2}|Mf\d{2}|[DMP]\d{2})/);
  return m ? m[1] : '';
}

/** 按部件名称（为空时退回系统）归类到大类/小类 */
export function classifyProduct(text: string): { major: string; minor: string } {
  const s = String(text || '').trim();
  if (!s) return { major: 'U 未分类', minor: '' };
  for (const major of PRODUCT_CLASSES) {
    for (const m of major.minors) {
      if (m.re.test(s)) return { major: `${major.code} ${major.name}`, minor: `${m.code} ${m.name}` };
    }
  }
  for (const major of PRODUCT_CLASSES) {
    if (major.re.test(s)) return { major: `${major.code} ${major.name}`, minor: '' };
  }
  return { major: 'U 未分类', minor: '' };
}

/** 记录的产品大类（旧记录没有编码时按部件名称即时推导） */
export function productMajorOf(rec: Pick<FmeaRecord, 'part' | 'system' | 'productCategory'>): string {
  return rec.productCategory || classifyProduct(rec.part || rec.system).major;
}

/** 记录的产品小类（旧记录即时推导，取不到小类返回空串） */
export function productMinorOf(rec: Pick<FmeaRecord, 'part' | 'system' | 'productSubCategory'>): string {
  if (rec.productSubCategory) return rec.productSubCategory;
  return classifyProduct(rec.part || rec.system).minor;
}

/** 失效模式编码：优先取已填编码，否则按现象文字匹配 F01~F18 */
export function deriveFailureCode(draft: FmeaDraft): string {
  if (draft.failureCode) return draft.failureCode;
  const text = [draft.failureMode, draft.failureEffect, draft.failureCause, draft.failureCategory, draft.conclusion].join(' ');
  for (const code of FAILURE_MATCH_ORDER) {
    const hit = FAILURE_CODES.find((f) => f.code === code);
    if (hit && hit.re.test(text)) return `${hit.code} ${hit.name}`;
  }
  const byCategory: Record<string, string> = {
    开裂: 'F01', 断裂: 'F01', 变形: 'F03', 脱落: 'F04', 泄漏: 'F02', 堵塞: 'F05',
    异响: 'F06', 磨损: 'F07', 外观: 'F08', 尺寸: 'F09', 功能: 'F10',
  };
  const code = byCategory[draft.failureCategory || deriveFailureCategory(draft)];
  if (code) {
    const hit = FAILURE_CODES.find((f) => f.code === code);
    if (hit) return `${hit.code} ${hit.name}`;
  }
  return '';
}

/** 原因编码：优先取已填编码，否则按原因文字匹配 D/M/P/Mf 细类 */
export function deriveCauseCode(draft: FmeaDraft): string {
  if (draft.causeCode) return draft.causeCode;
  const text = [draft.failureCause, draft.action, draft.measureType, draft.remark].join(' ');
  for (const code of CAUSE_MATCH_ORDER) {
    const hit = CAUSE_CODES.find((c) => c.code === code);
    if (hit && hit.re.test(text)) return `${hit.code} ${hit.name}`;
  }
  const category = draft.causeCategory || deriveCauseCategory(draft);
  if (category === '设计') return 'D 设计';
  if (category === '材料') return 'M 材料';
  if (category === '工艺') return 'P 工艺';
  if (category === '装配') return 'P04 装配顺序/扭矩/压装';
  return '';
}

/** 引用记录：哪个项目、谁、何时引用了这条案例 */
export interface FmeaCitation {
  projectId: string;
  projectName: string;
  username: string;
  displayName: string;
  at: string;
}

/** 卡片内容（可编辑部分） */
export interface FmeaDraft {
  system: string; // 系统 / 子系统
  machine: string; // 机种名称
  part: string; // 部件名称
  productCategory: string; // 产品大类（如 A 空气滤清器总成）
  productSubCategory: string; // 产品小类（如 A01 上壳体）
  material: string; // 本体使用材料
  failureMode: string; // 潜在的失效模式
  failureCode: string; // 失效模式编码（F01~F18）
  failureModeImage: string; // 失效模式图片（原表内嵌图片在此仅留标记）
  failureEffect: string; // 潜在的失效后果
  failureCause: string; // 潜在的失效起因 / 机理
  failureCategory: string; // 失效分类（受控字典）
  causeCategory: string; // 原因分类（设计/材料/工艺/装配/使用）
  causeCode: string; // 原因编码（D/M/P/Mf + 细类）
  riskLevel: RiskLevel; // 风险等级
  severity: string; // S 严重度 1~10
  occurrence: string; // O 频度 1~10
  detection: string; // D 探测度 1~10
  action: string; // 建议的措施
  measureType: string; // 措施类型
  verificationStatus: string; // 验证状态
  designGuide: string; // 设计规避（逐条换行）
  conclusion: string; // 一句话结论（≤40 字）
  keywords: string; // 关键词 / 同义词
  actionImage: string; // 措施对策图片 / 示例（同上）
  remark: string; // 备注
  owner: string; // 责任人
  recordDate: string; // 记录时间（YYYY-MM-DD，识别不了时保留原文）
}

export interface FmeaRecord extends FmeaDraft {
  schema: typeof FMEA_SCHEMA;
  id: string; // FM-2026-001
  sourceSheet: string; // 来源工作表（导入时记录）
  citations: FmeaCitation[]; // 引用记录（替代旧的手动「取用 +1」）
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  createdByDisplay: string;
  updatedBy: string;
  revision: number;
  useCount: number; // 旧版取用次数，仅作历史数据兼容
}

export type FmeaDraftKey = keyof FmeaDraft;

/** 表单 / 详情面板展示顺序（结构化字段按「基础 → 失效链 → 风险 → 措施 → 证据 → 管理」排列） */
export const FMEA_FIELDS: Array<{
  key: FmeaDraftKey;
  label: string;
  hint?: string;
  multiline?: boolean;
  options?: string[];
  allowCustom?: boolean;
  group?: string;
}> = [
  { key: 'system', label: '系统', hint: '固定选项或自定义输入', options: FMEA_SYSTEM_OPTIONS, allowCustom: true, group: '基础' },
  { key: 'machine', label: '机种名称', hint: '默认「通用」，可手动输入或覆盖', group: '基础' },
  { key: 'part', label: '部件名称', hint: '默认「未分类」，用于自动归类产品小类', group: '基础' },
  { key: 'productCategory', label: '产品大类', hint: 'A~J，来自分类字典', options: productMajorOptions(), group: '基础' },
  { key: 'productSubCategory', label: '产品小类', hint: '如 A01 上壳体', options: productMinorOptions(), group: '基础' },
  { key: 'material', label: '本体使用材料', hint: '如 PP-T20、PA66-GF30、SPCC', group: '基础' },
  { key: 'failureMode', label: '潜在的失效模式', hint: '一句话说清「坏成什么样」', multiline: true, group: '失效链' },
  { key: 'failureCategory', label: '失效分类', hint: '受控字典', options: FAILURE_CATEGORIES, group: '失效链' },
  { key: 'failureCode', label: '失效模式编码', hint: 'F01~F18', options: failureCodeOptions(), group: '失效链' },
  { key: 'failureCause', label: '潜在的失效起因 / 机理', hint: '分条填写，如 1. 壁厚不足', multiline: true, group: '失效链' },
  { key: 'causeCategory', label: '原因分类', hint: '设计/材料/工艺/装配/使用', options: CAUSE_CATEGORIES, group: '失效链' },
  { key: 'causeCode', label: '原因编码', hint: 'D/M/P/Mf + 细类', options: causeCodeOptions(), group: '失效链' },
  { key: 'failureEffect', label: '潜在的失效后果', hint: '尽量量化：泄漏率、抱怨数、成本', multiline: true, group: '失效链' },
  { key: 'conclusion', label: '一句话结论', hint: '对设计的核心提醒，≤40 字', multiline: true, group: '失效链' },
  { key: 'severity', label: '严重度 S', hint: '1~10，没有可留空', group: '风险' },
  { key: 'occurrence', label: '频度 O', hint: '1~10，没有可留空', group: '风险' },
  { key: 'detection', label: '探测度 D', hint: '1~10，没有可留空', group: '风险' },
  { key: 'riskLevel', label: '风险等级', hint: '留空则按后果自动判定', options: RISK_LEVELS.filter(Boolean) as string[], group: '风险' },
  { key: 'action', label: '建议的措施', hint: '可直接照做的对策', multiline: true, group: '措施' },
  { key: 'measureType', label: '措施类型', hint: '设计/材料/工艺/检测', options: MEASURE_TYPES, group: '措施' },
  { key: 'verificationStatus', label: '验证状态', hint: '未验证 / 已验证 / 已验证有效', options: VERIFY_STATUSES, group: '措施' },
  { key: 'designGuide', label: '设计规避', hint: '2~3 条可直接执行的设计动作，逐条换行', multiline: true, group: '措施' },
  { key: 'keywords', label: '关键词 / 同义词', hint: '便于检索，如 空滤器, 卡扣, 熔接痕', group: '管理' },
  { key: 'remark', label: '备注', multiline: true, group: '管理' },
  { key: 'owner', label: '责任人', group: '管理' },
  { key: 'recordDate', label: '记录时间', hint: 'YYYY-MM-DD', group: '管理' },
];

/** 图片列（原 Excel 用 WPS 内嵌图片，无法直接取二进制，只保留「含图片」标记） */
export const FMEA_IMAGE_FIELDS: Array<{ key: FmeaDraftKey; label: string }> = [
  { key: 'failureModeImage', label: '失效模式图片' },
  { key: 'actionImage', label: '措施对策图片' },
];

/** 表头别名：按顺序匹配，长词/受控字段必须排在通用字段（措施、分类、时间）之前 */
const HEADER_ALIASES: Array<{ key: FmeaDraftKey; re: RegExp }> = [
  { key: 'actionImage', re: /措施.*图片|对策.*图片|整改.*图|示例图|示例/ },
  { key: 'failureModeImage', re: /失效模式.*图片|模式图|图片|照片/ },
  { key: 'system', re: /系统|子系统/ },
  { key: 'productSubCategory', re: /产品小类|小类/ },
  { key: 'productCategory', re: /产品大类|大类/ },
  { key: 'machine', re: /机种|机型|车型|产品名称|项目名称|产品/ },
  { key: 'part', re: /部件|零件|零部件|组件|总成/ },
  { key: 'material', re: /材料|材质|牌号/ },
  { key: 'failureCode', re: /失效模式编码|模式编码|F\s*编码/i },
  { key: 'failureMode', re: /失效模式|故障模式|失效现象|失效表现/ },
  { key: 'failureCategory', re: /失效分类/ },
  { key: 'failureEffect', re: /失效后果|后果|影响/ },
  { key: 'failureCause', re: /失效起因|起因|机理|原因|根因/ },
  { key: 'causeCategory', re: /原因分类/ },
  { key: 'causeCode', re: /原因编码|原因细类|原因代码/ },
  { key: 'severity', re: /严重度|^S$/i },
  { key: 'occurrence', re: /频度|发生度|频次|^O$/i },
  { key: 'detection', re: /探测度|^D$/i },
  { key: 'riskLevel', re: /风险等级|风险级别|^风险$/ },
  { key: 'measureType', re: /措施类型/ },
  { key: 'verificationStatus', re: /验证状态|验证结果/ },
  { key: 'conclusion', re: /一句话结论|结论/ },
  { key: 'designGuide', re: /设计规避|规避/ },
  { key: 'keywords', re: /关键词|同义词|标签/ },
  { key: 'action', re: /建议的措施|建议措施|措施|对策|整改/ },
  { key: 'remark', re: /备注|说明/ },
  { key: 'owner', re: /责任人|负责人|责任/ },
  { key: 'recordDate', re: /记录时间|日期|时间|RPN/i },
];

/** 空卡片 */
export function emptyFmeaDraft(): FmeaDraft {
  return {
    system: '',
    machine: '通用',
    part: '未分类',
    productCategory: '',
    productSubCategory: '',
    material: '',
    failureMode: '',
    failureCode: '',
    failureModeImage: '',
    failureEffect: '',
    failureCause: '',
    failureCategory: '',
    causeCategory: '',
    causeCode: '',
    riskLevel: '',
    severity: '',
    occurrence: '',
    detection: '',
    action: '',
    measureType: '',
    verificationStatus: '',
    designGuide: '',
    conclusion: '',
    keywords: '',
    actionImage: '',
    remark: '',
    owner: '',
    recordDate: '',
  };
}

/** WPS 内嵌图片公式 =DISPIMG("ID_xxx",1) → 统一标记，其余单元格保留原文 */
export function normalizeImageCell(value: string): string {
  const s = String(value || '').trim();
  if (!s) return '';
  if (/DISPIMG|_xlfn\.DISPIMG/i.test(s)) return '含图片';
  return s;
}

/** 判断图片字段是否存着 dataURL（操作者导入/粘贴的图片） */
export function isImageDataUrl(value: string): boolean {
  return /^data:image\/(png|jpe?g|gif|webp|bmp);base64,/i.test(String(value || '').trim());
}

/** 判断图片字段是否为 Excel 内嵌图片标记（原表 DISPIMG 公式还原） */
export function isImagePlaceholder(value: string): boolean {
  return String(value || '').trim() === '含图片';
}

/** 失效分类关键词规则（按顺序命中，先具体后笼统） */
const CATEGORY_RULES: Array<[string, RegExp]> = [
  ['开裂', /开裂|裂纹|裂缝|龟裂|裂开/],
  ['断裂', /断裂|折断|脆断|断开|断裂/],
  ['变形', /变形|翘曲|收缩|扭曲|凹陷|翘起/],
  ['脱落', /脱落|脱出|松脱|掉落|分离|脱开|掉出/],
  ['泄漏', /泄漏|漏油|漏气|渗漏|泄露|渗油/],
  ['堵塞', /堵塞|阻塞|堵死|堵住/],
  ['异响', /异响|噪声|噪音|啸叫/],
  ['磨损', /磨损|磨耗|刮擦|拉伤/],
  ['外观', /喷霜|发白|色差|缩痕|飞边|毛刺|划伤|外观/],
  ['尺寸', /尺寸|超差|公差|间隙|面差/],
];

/** 按失效模式 / 后果 / 原因的文字判定失效分类 */
export function deriveFailureCategory(draft: FmeaDraft): string {
  if (draft.failureCategory) return draft.failureCategory;
  const text = [draft.failureMode, draft.failureEffect, draft.failureCause].join(' ');
  for (const [name, re] of CATEGORY_RULES) if (re.test(text)) return name;
  return '';
}

/** 按原因 / 措施文字判定原因分类 */
export function deriveCauseCategory(draft: FmeaDraft): string {
  if (draft.causeCategory) return draft.causeCategory;
  const text = [draft.failureCause, draft.action, draft.remark].join(' ');
  if (/材料|牌号|配方|收缩率|玻纤|助剂/.test(text)) return '材料';
  if (/模具|注塑|焊接|热板|超声|激光|工艺|熔接痕|浇口/.test(text)) return '工艺';
  if (/装配|拧紧|扭矩|定位|工装|夹具/.test(text)) return '装配';
  if (/误操作|使用不当|用户使用/.test(text)) return '使用';
  if (draft.failureCause) return '设计';
  return '';
}

/** S × O × D；任一项缺失返回 null */
export function fmeaRpn(rec: Pick<FmeaDraft, 'severity' | 'occurrence' | 'detection'>): number | null {
  const s = Number(rec.severity);
  const o = Number(rec.occurrence);
  const d = Number(rec.detection);
  if (![s, o, d].every((n) => Number.isInteger(n) && n >= 1 && n <= 10)) return null;
  return s * o * d;
}

/**
 * 风险等级：有 S/O/D 时按 RPN 分级；历史案例没有评分时按后果定性判定，不臆造数字。
 * 定性规则：安全/法规/召回/批量失效 → 高；抱怨/返修/功能下降 → 中；外观/舒适性 → 低。
 */
export function deriveRiskLevel(draft: FmeaDraft): RiskLevel {
  if (draft.riskLevel) return draft.riskLevel;
  const rpn = fmeaRpn(draft);
  if (rpn !== null) return rpn >= 100 ? '高' : rpn >= 40 ? '中' : '低';
  const text = [draft.failureEffect, draft.failureMode, draft.remark, draft.conclusion].join(' ');
  if (/安全|法规|召回|人身|起火|冒烟|制动|转向|批量/.test(text)) return '高';
  if (/抱怨|返修|功能下降|异响|泄漏|漏油|开裂|断裂|变形|脱落/.test(text)) return '中';
  if (/外观|色差|喷霜|划伤|舒适|手感/.test(text)) return '低';
  return '中';
}

/** 规范化风险等级：非法值退回空串 */
export function normalizeRiskLevel(value: unknown): RiskLevel {
  const s = String(value ?? '').trim();
  if (s === '高' || s === '中' || s === '低') return s;
  if (/high/i.test(s)) return '高';
  if (/mid|medium/i.test(s)) return '中';
  if (/low/i.test(s)) return '低';
  return '';
}

/** 一句话结论：≤40 字，优先取已填内容，否则由失效模式 + 后果压缩 */
export function deriveConclusion(draft: FmeaDraft): string {
  const given = String(draft.conclusion || '').replace(/\s+/g, ' ').trim();
  if (given) return given.length > 40 ? `${given.slice(0, 39)}…` : given;
  const mode = String(draft.failureMode || '').replace(/\s+/g, ' ').trim();
  const effect = String(draft.failureEffect || '').replace(/\s+/g, ' ').trim();
  const text = mode && effect ? `${mode}，${effect}` : mode || effect;
  return text.length > 40 ? `${text.slice(0, 39)}…` : text;
}

/** 设计规避：优先取已填内容，否则把建议措施拆成最多 3 条 */
export function deriveDesignGuide(draft: FmeaDraft): string {
  const given = String(draft.designGuide || '').trim();
  if (given) return given;
  return String(draft.action || '')
    .split(/[\n；;。]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join('\n');
}

/** 占位值：原表里的「填写示例 / 责任人填写 / 插入图片」等无效内容 */
const PLACEHOLDER_VALUE_RE =
  /^(填写示例|填写案例|填写|示例|插入图片|图片|文字描述|文字说明|示意图|责任人填写|待补充|待补图|待删|无|—|-|N\/A)$/i;

export function isPlaceholderValue(value: string): boolean {
  const s = String(value || '').trim();
  if (!s) return false;
  if (PLACEHOLDER_VALUE_RE.test(s)) return true;
  return /填写示例|填写案例|责任人填写|插入图片|文字描述|示意图|请删除本行/i.test(s);
}

/** R01：占位行/示例行不进入正式库 */
export function isPlaceholderDraft(draft: FmeaDraft): boolean {
  if (!draft.failureMode.trim()) return true;
  if (isPlaceholderValue(draft.failureMode)) return true;
  const core = [
    draft.machine,
    draft.part,
    draft.material,
    draft.failureMode,
    draft.failureEffect,
    draft.failureCause,
    draft.action,
    draft.owner,
  ];
  return core.filter((v) => v.trim() && !isPlaceholderValue(v)).length < 2;
}

/** R02：同机种 + 部件 + 失效模式 + 原因 视为重复案例 */
export function fmeaDedupeKey(draft: FmeaDraft): string {
  const norm = (s: string) => String(s || '').replace(/\s+/g, '').toLowerCase();
  return [draft.machine, draft.part, draft.failureMode, draft.failureCause].map(norm).join('|');
}

/** 补齐结构化字段：分类、产品编码、风险、结论、设计规避（不改动手工填写的内容） */
export function applyStructuredDefaults(draft: FmeaDraft): FmeaDraft {
  const machine = String(draft.machine || '').trim() || '通用';
  const part = String(draft.part || '').trim() || '未分类';
  const product = classifyProduct(part || draft.system);
  const merged: FmeaDraft = {
    ...draft,
    machine,
    part,
    productCategory: draft.productCategory || product.major,
    productSubCategory: draft.productSubCategory || (draft.productCategory ? '' : product.minor),
    failureCategory: draft.failureCategory || deriveFailureCategory(draft),
    failureCode: draft.failureCode || deriveFailureCode(draft),
    causeCategory: deriveCauseCategory(draft),
    causeCode: draft.causeCode || deriveCauseCode(draft),
    conclusion: deriveConclusion(draft),
    designGuide: deriveDesignGuide(draft),
    riskLevel: draft.riskLevel || deriveRiskLevel(draft),
  };
  return merged;
}

/** 引用记录解析（旧记录没有该字段） */
export function parseFmeaCitations(raw: unknown): FmeaCitation[] {
  if (!Array.isArray(raw)) return [];
  const out: FmeaCitation[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Partial<FmeaCitation>;
    out.push({
      projectId: String(o.projectId || ''),
      projectName: String(o.projectName || ''),
      username: String(o.username || ''),
      displayName: String(o.displayName || ''),
      at: String(o.at || ''),
    });
  }
  return out;
}

/** 追加一条引用记录 */
export function addFmeaCitation(rec: FmeaRecord, citation: FmeaCitation): FmeaRecord {
  return { ...rec, citations: [...rec.citations, citation], updatedAt: new Date().toISOString() };
}

/** 常用同义词表（标准词 → 同义词/近义词） */
export const FMEA_SYNONYMS: Record<string, string[]> = {
  泄漏: ['漏油', '渗漏', '漏气', '泄露', '渗油'],
  开裂: ['裂纹', '断裂', '破裂', '裂开', '裂缝'],
  变形: ['翘曲', '收缩', '扭曲', '凹陷'],
  脱落: ['脱出', '松脱', '掉落', '分离', '脱开'],
  堵塞: ['阻塞', '堵死', '堵住'],
  异响: ['噪声', '噪音', '啸叫'],
  磨损: ['磨耗', '刮擦', '拉伤'],
  外观: ['喷霜', '发白', '划伤', '色差', '缩痕'],
};

/** 查询词扩展：输入同义词也能命中标准词，反之亦然 */
export function expandFmeaTerms(query: string): string[] {
  const parts = String(query || '')
    .toLowerCase()
    .split(/[\s,，、;；]+/)
    .filter(Boolean);
  const terms = new Set<string>();
  for (const part of parts) {
    terms.add(part);
    for (const [standard, list] of Object.entries(FMEA_SYNONYMS)) {
      if (part === standard || list.some((w) => part === w || part.includes(w) || w.includes(part))) {
        terms.add(standard);
        list.forEach((w) => terms.add(w));
      }
    }
  }
  return Array.from(terms);
}

/** 字段加权（越大越先命中）：标题/失效模式权重最高 */
const SEARCH_FIELD_WEIGHTS: Array<[number, (rec: FmeaRecord) => string]> = [
  [8, (r) => r.failureMode],
  [6, (r) => r.keywords],
  [5, (r) => r.failureCode],
  [4, (r) => r.part],
  [4, (r) => r.productSubCategory],
  [4, (r) => r.failureCategory],
  [3, (r) => r.productCategory],
  [3, (r) => r.causeCode],
  [3, (r) => r.system],
  [3, (r) => r.conclusion],
  [3, (r) => r.failureCause],
  [2, (r) => r.material],
  [2, (r) => r.machine],
  [2, (r) => r.failureEffect],
  [2, (r) => r.action],
  [2, (r) => r.designGuide],
  [1, (r) => `${r.owner} ${r.remark}`],
];

/** 相关度评分 + 命中词（用于高亮）；空查询返回 0 */
export function scoreFmeaRecord(rec: FmeaRecord, query: string): { score: number; terms: string[] } {
  const terms = expandFmeaTerms(query);
  if (!terms.length) return { score: 0, terms: [] };
  const fields = SEARCH_FIELD_WEIGHTS.map(([w, get]) => [w, get(rec).toLowerCase()] as const);
  let score = 0;
  const matched: string[] = [];
  for (const term of terms) {
    let hit = false;
    for (const [w, text] of fields) {
      if (text.includes(term)) {
        score += w;
        hit = true;
      }
    }
    if (hit) matched.push(term);
  }
  return { score, terms: matched };
}

/** 相似案例：同部件 > 同材料 > 同失效分类 > 同机种/系统 */
export function similarFmeaRecords(rec: FmeaRecord, list: FmeaRecord[], limit = 5): FmeaRecord[] {
  return list
    .filter((x) => x.id !== rec.id)
    .map((x) => {
      let score = 0;
      if (rec.part && x.part === rec.part) score += 3;
      if (rec.material && x.material === rec.material) score += 2;
      if (rec.failureCategory && x.failureCategory === rec.failureCategory) score += 2;
      if (rec.machine && x.machine === rec.machine) score += 1;
      if (rec.system && x.system === rec.system) score += 1;
      return { x, score };
    })
    .filter((p) => p.score > 0)
    .sort((a, b) => b.score - a.score || b.x.id.localeCompare(a.x.id))
    .slice(0, limit)
    .map((p) => p.x);
}

/** 清洗单元格：去首尾空白，压缩连续空格（保留换行，便于阅读长文本） */
function cleanCell(value: unknown): string {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\u00a0]+/g, ' ')
    .trim();
}

/** Excel 序列号日期 → YYYY-MM-DD（1900 日期系统） */
function excelSerialToDate(n: number): string | null {
  if (!Number.isFinite(n) || n <= 0 || n > 60000) return null;
  const ms = Math.round((n - 25569) * 86400000);
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 规范化记录时间：支持 2026-3-5 / 2026.3.5 / 2026/3/5 / 2026年3月 / Excel 序列号 */
export function normalizeRecordDate(value: string | number): string {
  if (typeof value === 'number') return excelSerialToDate(value) || '';
  const s = String(value || '').trim();
  if (!s) return '';
  if (/^\d{5}$/.test(s)) {
    const d = excelSerialToDate(Number(s));
    if (d) return d;
  }
  const m = s.match(/(\d{4})\s*[年./\-]\s*(\d{1,2})(?:\s*[月./\-]\s*(\d{1,2}))?/);
  if (m) {
    const y = m[1];
    const mo = String(Number(m[2])).padStart(2, '0');
    const day = m[3] ? String(Number(m[3])).padStart(2, '0') : '';
    return day ? `${y}-${mo}-${day}` : `${y}-${mo}`;
  }
  return s;
}

/** 从记录时间取年份（取不到用当前年） */
export function yearFromDate(text: string, now = new Date()): number {
  const m = String(text || '').match(/(19|20)\d{2}/);
  return m ? Number(m[0]) : now.getFullYear();
}

/**
 * 编号用年份：记录时间优先；旧表没有记录时间时按工作表名（如 2025年）取年份。
 * 这样历年案例的编号仍然是 FM-2025-xxx，而不是全部落到导入当年。
 */
export function recordYearForId(recordDate: string, sourceSheet = '', now = new Date()): number {
  const m = String(recordDate || '').match(/(19|20)\d{2}/);
  if (m) return Number(m[0]);
  const s = String(sourceSheet || '').match(/(19|20)\d{2}/);
  if (s) return Number(s[0]);
  return now.getFullYear();
}

/** 判定表头行：至少命中 3 个已知列名，且包含「失效模式」相关列 */
function findHeaderRow(rows: string[][]): number {
  const limit = Math.min(rows.length, 12);
  for (let r = 0; r < limit; r++) {
    const cells = rows[r] || [];
    let hit = 0;
    let hasMode = false;
    for (const cell of cells) {
      if (!cell) continue;
      const matched = HEADER_ALIASES.find((a) => a.re.test(cell));
      if (matched) {
        hit++;
        if (matched.key === 'failureMode') hasMode = true;
      }
    }
    if (hit >= 3 && hasMode) return r;
  }
  return -1;
}

export interface FmeaParsedRow {
  draft: FmeaDraft;
  sourceSheet: string;
  rowNumber: number;
}

export interface FmeaParseResult {
  rows: FmeaParsedRow[];
  warnings: string[];
  skipped: number;
}

/** 小节标题 / 填写示例行：只占一个单元格，或以「示例」开头 */
function isNonDataRow(cells: string[]): boolean {
  const filled = cells.filter(Boolean);
  if (!filled.length) return true;
  if (filled.length === 1) return true;
  const joined = filled.join(' ');
  if (/填写示例|请删除本行|^示例[：:]|^注[：:]/.test(joined)) return true;
  if (/^(年|季度|月份)/.test(filled[0]) && filled.length <= 2) return true;
  return false;
}

/**
 * 解析二维数组（CSV / Excel 共用）。
 * 自动定位表头行，跳过小节标题、填写示例与空行。
 */
export function parseFmeaRows(rows: string[][], sourceSheet = ''): FmeaParseResult {
  const clean = (rows || []).map((r) => (r || []).map(cleanCell));
  const headerIdx = findHeaderRow(clean);
  if (headerIdx < 0) {
    return { rows: [], warnings: ['未找到表头行（需包含「机种名称、部件名称、失效模式」等列）'], skipped: 0 };
  }
  const header = clean[headerIdx];
  const map: Partial<Record<FmeaDraftKey, number>> = {};
  header.forEach((h, i) => {
    if (!h) return;
    for (const a of HEADER_ALIASES) {
      if (map[a.key] == null && a.re.test(h)) {
        map[a.key] = i;
        break;
      }
    }
  });
  if (map.failureMode == null) {
    return { rows: [], warnings: ['表头缺少「潜在的失效模式」列'], skipped: 0 };
  }

  const out: FmeaParsedRow[] = [];
  const warnings: string[] = [];
  let skipped = 0;
  const seen = new Set<string>();
  let duplicates = 0;
  for (let r = headerIdx + 1; r < clean.length; r++) {
    const cells = clean[r];
    if (isNonDataRow(cells)) {
      skipped++;
      continue;
    }
    const get = (k: FmeaDraftKey): string => {
      const idx = map[k];
      return idx == null ? '' : cells[idx] || '';
    };
    const built: FmeaDraft = {
      system: get('system'),
      machine: get('machine'),
      part: get('part'),
      productCategory: get('productCategory'),
      productSubCategory: get('productSubCategory'),
      material: get('material'),
      failureMode: get('failureMode'),
      failureCode: get('failureCode'),
      failureModeImage: normalizeImageCell(get('failureModeImage')),
      failureEffect: get('failureEffect'),
      failureCause: get('failureCause'),
      failureCategory: get('failureCategory'),
      causeCategory: get('causeCategory'),
      causeCode: get('causeCode'),
      riskLevel: normalizeRiskLevel(get('riskLevel')),
      severity: get('severity'),
      occurrence: get('occurrence'),
      detection: get('detection'),
      action: get('action'),
      measureType: get('measureType'),
      verificationStatus: get('verificationStatus'),
      designGuide: get('designGuide'),
      conclusion: get('conclusion'),
      keywords: get('keywords'),
      actionImage: normalizeImageCell(get('actionImage')),
      remark: get('remark'),
      owner: get('owner'),
      recordDate: normalizeRecordDate(get('recordDate')),
    };
    // R01：示例/占位行不入库；缺失效模式同样跳过
    if (!built.failureMode || isPlaceholderDraft(built)) {
      skipped++;
      continue;
    }
    const draft = applyStructuredDefaults(built);
    // R02：同机种 + 部件 + 失效模式 + 原因 视为重复案例
    const key = fmeaDedupeKey(draft);
    if (seen.has(key)) {
      duplicates++;
      skipped++;
      continue;
    }
    seen.add(key);
    out.push({ draft, sourceSheet, rowNumber: r + 1 });
  }
  if (duplicates > 0) warnings.push(`合并 ${duplicates} 条重复案例（同机种+部件+失效模式+原因）`);
  return { rows: out, warnings, skipped };
}

/** 拆分一行 CSV：支持双引号包裹与 "" 转义 */
export function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',' || ch === '\t') {
      cells.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells;
}

/** 解析 CSV（表头映射，一行一张卡片） */
export function parseFmeaCsv(text: string): FmeaParseResult {
  const rows = String(text || '')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map(splitCsvLine);
  return parseFmeaRows(rows, 'CSV');
}

/** 解析 Excel：合并所有工作表（跳过 WPS 图片索引表） */
export async function parseFmeaXlsx(file: File | ArrayBuffer): Promise<FmeaParseResult> {
  const data = file instanceof File ? await file.arrayBuffer() : file;
  const XLSX = await import('xlsx');
  const wb = XLSX.read(data, { type: 'array' });
  const merged: FmeaParsedRow[] = [];
  const warnings: string[] = [];
  let skipped = 0;
  for (const name of wb.SheetNames) {
    if (/CellImg|Reserved|图片索引/i.test(name)) continue;
    const ws = wb.Sheets[name];
    if (!ws) continue;
    const raw = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: '' });
    const rows = raw.map((r) => (r || []).map((c) => cleanCell(c)));
    const res = parseFmeaRows(rows, name);
    if (res.warnings.length) warnings.push(`${name}：${res.warnings[0]}`);
    merged.push(...res.rows);
    skipped += res.skipped;
  }
  return { rows: merged, warnings, skipped };
}

export interface FmeaIssue {
  field: string;
  level: 'error' | 'warning';
  message: string;
}

export interface FmeaValidation {
  issues: FmeaIssue[];
  errors: FmeaIssue[];
  warnings: FmeaIssue[];
}

/** 校验：失效模式与建议措施必填，其余缺项只提示 */
export function validateFmeaDraft(draft: FmeaDraft): FmeaValidation {
  const issues: FmeaIssue[] = [];
  const req = (key: FmeaDraftKey, label: string) => {
    if (!String(draft[key] || '').trim()) issues.push({ field: key, level: 'error', message: `${label}不能为空` });
  };
  req('failureMode', '潜在的失效模式');
  req('action', '建议的措施');

  const warn = (key: FmeaDraftKey, label: string) => {
    if (!String(draft[key] || '').trim()) issues.push({ field: key, level: 'warning', message: `${label}为空，检索时不易被找到` });
  };
  warn('machine', '机种名称');
  warn('part', '部件名称');
  warn('failureEffect', '失效后果');
  warn('failureCause', '失效起因/机理');
  if (draft.recordDate && !/^\d{4}(-\d{2})?(-\d{2})?$/.test(draft.recordDate)) {
    issues.push({ field: 'recordDate', level: 'warning', message: '记录时间格式建议为 YYYY-MM-DD' });
  }
  return {
    issues,
    errors: issues.filter((i) => i.level === 'error'),
    warnings: issues.filter((i) => i.level === 'warning'),
  };
}

/** 编号：FM-年份-三位序号 */
export function formatFmeaId(year: number, seq: number): string {
  return `FM-${year}-${String(seq).padStart(3, '0')}`;
}

/** 从已有文件名中取该年份已用的最大序号 */
export function nextFmeaId(fileNames: string[], year: number): string {
  let max = 0;
  for (const name of fileNames) {
    const m = String(name || '').match(/FM-(\d{4})-(\d{3,})/i);
    if (!m) continue;
    if (Number(m[1]) !== year) continue;
    max = Math.max(max, Number(m[2]));
  }
  return formatFmeaId(year, max + 1);
}

/** 归档文件名即编号 */
export function fmeaFileName(id: string): string {
  return `${cleanFileName(id)}.parquet`;
}

/** 从归档文件名取编号 */
export function parseFmeaFileName(name: string): string {
  const stem = String(name || '').replace(/\.(parquet|json|csv)$/i, '');
  const m = stem.match(/FM-\d{4}-\d{3,}/i);
  return m ? m[0].toUpperCase() : stem;
}

/** 反序列化记录 */
export function parseFmeaRecord(text: string): FmeaRecord | null {
  try {
    const raw = JSON.parse(text) as Partial<FmeaRecord>;
    if (!raw || raw.schema !== FMEA_SCHEMA) return null;
    const id = typeof raw.id === 'string' ? raw.id : '';
    if (!id) return null;
    const str = (v: unknown) => (typeof v === 'string' ? v : '');
    return {
      schema: FMEA_SCHEMA,
      id,
      system: str(raw.system),
      machine: str(raw.machine),
      part: str(raw.part),
      productCategory: str(raw.productCategory),
      productSubCategory: str(raw.productSubCategory),
      material: str(raw.material),
      failureMode: str(raw.failureMode),
      failureCode: str(raw.failureCode),
      failureModeImage: str(raw.failureModeImage),
      failureEffect: str(raw.failureEffect),
      failureCause: str(raw.failureCause),
      failureCategory: str(raw.failureCategory),
      causeCategory: str(raw.causeCategory),
      causeCode: str(raw.causeCode),
      riskLevel: normalizeRiskLevel(raw.riskLevel),
      severity: str(raw.severity),
      occurrence: str(raw.occurrence),
      detection: str(raw.detection),
      action: str(raw.action),
      measureType: str(raw.measureType),
      verificationStatus: str(raw.verificationStatus),
      designGuide: str(raw.designGuide),
      conclusion: str(raw.conclusion),
      keywords: str(raw.keywords),
      actionImage: str(raw.actionImage),
      remark: str(raw.remark),
      owner: str(raw.owner),
      recordDate: str(raw.recordDate),
      sourceSheet: str(raw.sourceSheet),
      citations: parseFmeaCitations((raw as { citations?: unknown }).citations),
      createdAt: str(raw.createdAt),
      updatedAt: str(raw.updatedAt),
      createdBy: str(raw.createdBy),
      createdByDisplay: str(raw.createdByDisplay),
      updatedBy: str(raw.updatedBy),
      revision: Number(raw.revision) > 0 ? Number(raw.revision) : 1,
      useCount: Number(raw.useCount) > 0 ? Number(raw.useCount) : 0,
    };
  } catch {
    return null;
  }
}

/** 序列化（浏览器调试 / 测试用；正式入库写 Parquet） */
export function serializeFmeaRecord(rec: FmeaRecord): string {
  return JSON.stringify(rec, null, 2);
}

/** 记录 → 草稿（编辑回填） */
export function draftFromRecord(rec: FmeaRecord): FmeaDraft {
  return {
    system: rec.system,
    machine: rec.machine,
    part: rec.part,
    productCategory: rec.productCategory,
    productSubCategory: rec.productSubCategory,
    material: rec.material,
    failureMode: rec.failureMode,
    failureCode: rec.failureCode,
    failureModeImage: rec.failureModeImage,
    failureEffect: rec.failureEffect,
    failureCause: rec.failureCause,
    failureCategory: rec.failureCategory,
    causeCategory: rec.causeCategory,
    causeCode: rec.causeCode,
    riskLevel: rec.riskLevel,
    severity: rec.severity,
    occurrence: rec.occurrence,
    detection: rec.detection,
    action: rec.action,
    measureType: rec.measureType,
    verificationStatus: rec.verificationStatus,
    designGuide: rec.designGuide,
    conclusion: rec.conclusion,
    keywords: rec.keywords,
    actionImage: rec.actionImage,
    remark: rec.remark,
    owner: rec.owner,
    recordDate: rec.recordDate,
  };
}

/** 草稿 → 记录（新建或升版） */
export function buildFmeaRecord(
  draft: FmeaDraft,
  meta: {
    id: string;
    sourceSheet?: string;
    username: string;
    displayName?: string;
    previous?: FmeaRecord | null;
  },
): FmeaRecord {
  const now = new Date().toISOString();
  // 入库前统一补齐分类 / 风险等级 / 结论 / 设计规避，检索与详情无需再兜底
  const structured = applyStructuredDefaults(draft);
  return {
    schema: FMEA_SCHEMA,
    id: meta.id,
    ...structured,
    sourceSheet: meta.sourceSheet ?? meta.previous?.sourceSheet ?? '',
    citations: meta.previous?.citations ?? [],
    createdAt: meta.previous?.createdAt || now,
    updatedAt: now,
    createdBy: meta.previous?.createdBy || meta.username,
    createdByDisplay: meta.previous?.createdByDisplay || meta.displayName || meta.username,
    updatedBy: meta.username,
    revision: meta.previous ? meta.previous.revision + 1 : 1,
    useCount: meta.previous?.useCount ?? 0,
  };
}

const CSV_HEADER = [
  '编号',
  '系统/子系统',
  '机种名称',
  '部件名称',
  '产品大类',
  '产品小类',
  '本体使用材料',
  '潜在的失效模式',
  '失效模式编码',
  '失效分类',
  '潜在的失效后果',
  '潜在的失效起因/机理',
  '原因编码',
  '原因分类',
  '严重度S',
  '频度O',
  '探测度D',
  '风险等级',
  '建议的措施',
  '措施类型',
  '验证状态',
  '设计规避',
  '一句话结论',
  '关键词',
  '备注',
  '责任人',
  '记录时间',
  '引用次数',
];

function csvCell(v: string | number): string {
  return `"${String(v ?? '').replace(/"/g, '""')}"`;
}

/** 单张卡片导出为 CSV（Excel 可直接打开） */
export function fmeaRecordToCsv(rec: FmeaRecord): string {
  return [
    '\uFEFF' + CSV_HEADER.join(','),
    [
      rec.id,
      rec.system,
      rec.machine,
      rec.part,
      rec.productCategory,
      rec.productSubCategory,
      rec.material,
      rec.failureMode,
      rec.failureCode,
      rec.failureCategory,
      rec.failureEffect,
      rec.failureCause,
      rec.causeCode,
      rec.causeCategory,
      rec.severity,
      rec.occurrence,
      rec.detection,
      rec.riskLevel,
      rec.action,
      rec.measureType,
      rec.verificationStatus,
      rec.designGuide,
      rec.conclusion,
      rec.keywords,
      rec.remark,
      rec.owner,
      rec.recordDate,
      rec.citations.length,
    ]
      .map(csvCell)
      .join(','),
  ].join('\r\n');
}

export function fmeaCsvFileName(rec: FmeaRecord): string {
  return `${rec.id}.csv`;
}

/** 复制到剪贴板的卡片文本 */
export function fmeaCardText(rec: FmeaRecord): string {
  const line = (label: string, value: string) => (value ? `${label}：${value}\n` : '');
  return (
    `【FMEA 知识卡片】${rec.id}\n` +
    line('系统/子系统', rec.system) +
    line('机种名称', rec.machine) +
    line('部件名称', rec.part) +
    line('产品分类', [rec.productCategory, rec.productSubCategory].filter(Boolean).join(' / ')) +
    line('本体材料', rec.material) +
    line('失效模式', rec.failureMode) +
    line('失效模式编码', rec.failureCode) +
    line('失效分类', rec.failureCategory) +
    line('失效后果', rec.failureEffect) +
    line('失效起因/机理', rec.failureCause) +
    line('原因编码', rec.causeCode) +
    line('原因分类', rec.causeCategory) +
    line('风险等级', rec.riskLevel) +
    line('严重度/频度/探测度', [rec.severity, rec.occurrence, rec.detection].filter(Boolean).join(' / ')) +
    line('建议措施', rec.action) +
    line('措施类型', rec.measureType) +
    line('验证状态', rec.verificationStatus) +
    line('设计规避', rec.designGuide) +
    line('一句话结论', rec.conclusion) +
    line('备注', rec.remark) +
    line('责任人', rec.owner) +
    line('记录时间', rec.recordDate)
  ).trim();
}

/** 检索用全文（小写、去多余空白） */
export function fmeaSearchText(rec: FmeaRecord): string {
  return [
    rec.id,
    rec.system,
    rec.machine,
    rec.part,
    rec.productCategory,
    rec.productSubCategory,
    rec.material,
    rec.failureMode,
    rec.failureCode,
    rec.failureCategory,
    rec.failureEffect,
    rec.failureCause,
    rec.causeCode,
    rec.causeCategory,
    rec.riskLevel,
    rec.action,
    rec.measureType,
    rec.verificationStatus,
    rec.designGuide,
    rec.conclusion,
    rec.keywords,
    rec.remark,
    rec.owner,
    rec.recordDate,
  ]
    .join(' ')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/** CSV 模板：表头 + 一行明确标注「请删除本行」的示例，避免误入库 */
export function fmeaTemplateCsv(): string {
  const header = [
    '产品大类',
    '产品小类',
    '本体使用材料',
    '潜在的失效模式',
    '失效模式编码',
    '失效分类',
    '潜在的失效后果',
    '潜在的失效起因/机理',
    '原因编码',
    '原因分类',
    '严重度S',
    '频度O',
    '探测度D',
    '风险等级',
    '建议的措施',
    '措施类型',
    '验证状态',
    '设计规避',
    '一句话结论',
    '关键词',
    '备注',
    '责任人',
    '记录时间',
  ];
  const example = [
    'A 空气滤清器总成',
    'A01 上壳体',
    'PP-T20',
    '壳体卡扣根部断裂',
    'F01 开裂/断裂',
    '开裂',
    '装配后松脱、密封失效',
    '卡扣根部壁厚不足且位于熔接痕处',
    'D03 卡扣/锁止设计不当',
    '设计',
    '',
    '',
    '',
    '高',
    '根部壁厚 1.5→2.0 mm，浇口移至非受力侧',
    '设计',
    '已验证有效',
    '卡扣根部圆角 ≥0.5 mm，避免熔接痕落在受力根部',
    '卡扣根部壁厚不足导致断裂',
    '空滤器, 卡扣, 熔接痕',
    '示例行，导入前请删除本行',
    '张三',
    '2026-01-15',
  ];
  const quote = (v: string) => `"${v.replace(/"/g, '""')}"`;
  return [header.map(quote).join(','), example.map(quote).join(',')].join('\r\n');
}
