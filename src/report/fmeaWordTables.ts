/**
 * FMEA 标准词表
 *
 * 方案要求：检索不准八成是因为词不统一。
 * 三张基础表（失效模式 / 失效原因 / 失效后果）做同义词归并，
 * 每条记录在入库时自动归并到主词，原词保留在 raw* 字段里便于追溯。
 *
 * 维护规则（见方案 3.4 节）：
 *   新增词须评审；同义词只保留一个主词；
 *   按"可控的设计因素"编写失效原因（避免"工人不小心"这类不可控描述）。
 */

/** 失效模式主词（方案建议 + 进气系统实际高频） */
export const FAILURE_MODE_MASTER = [
  '破裂',      // 断裂/开裂/裂纹/爆裂/破损
  '变形',      // 内收缩/外鼓/翘曲/扭曲/冷料斑
  '脱落',      // 脱出/掉出/分离/脱开/浮纤
  '泄漏',      // 泄露/漏气/漏油/漏水
  '堵塞',      // 堵死/流通不畅/卡滞
  '卡滞',      // 卡接不良/卡扣失效/弹起不足
  '异响',      // 噪音/抖动/共振/碰擦异响
  '腐蚀',      // 老化/龟裂/粉化
  '松动',      // 滑丝/脱扣/螺纹失效/抗旋不足
  '错装',      // 装配不到位/间隙过大/孔位偏差
  '干涉',      // 合模干涉/结构干涉/运动干涉
  '焊合不良',  // 焊接开裂/脱开/强度不足/熔接痕
  '注塑不良',  // 缺料/溢料/熔接痕/浮纤/尺寸超差
  '外观不良',  // 冷料斑/鱼鳞纹/浮纤/脏污/色差
  '性能下降',  // 密封失效/流量不足/压降超标/效率下降
  '寿命不足',  // 路试断裂/疲劳失效/耐久不足
] as const;

export type FailureModeMaster = (typeof FAILURE_MODE_MASTER)[number];

/** 失效原因主词（按"可控的设计因素"分类，避免不可控描述） */
export const FAILURE_CAUSE_MASTER = [
  '材料选型不当',    // 材料韧性不够/耐温不够/收缩率不匹配/PA6不适配热板焊
  '壁厚不足',        // 壁厚太薄/加强筋缺失/薄壁大面积
  '密封压缩量不足',  // 压缩量偏小/压缩量不均/过盈量太小
  '材料耐温不够',    // 高温老化/低温脆断/热稳定性差
  '装配空间不足',    // 卡接间隙不够/回弹空间不足/工装干涉
  '流道设计不合理',  // 浇口位置不当/流道长/熔接痕集中受力区
  '焊接工艺不当',    // 焊接温度过高/加热位置错位/加热时间不足
  '结构设计不当',    // 应力集中/开槽削弱结构/熔接痕在受力位置
  '尺寸超差',        // 孔位偏差/椭圆度超差/拔脱力不足/轮廓不符
  '模具设计不良',    // 排气不佳/针阀浇口拉烂/斜导柱干涉/口模缺损
  '工艺参数不当',    // 打紧力过大/转速过高/压力不足/温度漂移
  '包装防护不足',    // 运输磕碰/防护不足/标签扯破
  '定位结构缺失',    // 无径向限位/无防旋转/无防脱/定位结构缺失
  '表面质量差',      // 冷刀切割不良/吹塑外观差/鱼鳞纹/脏污
  '预埋螺母问题',    // 下沉深度不够/抗旋力矩不足/法兰盘强度不够
] as const;

export type FailureCauseMaster = (typeof FAILURE_CAUSE_MASTER)[number];

/** 失效后果主词（按影响对象分类） */
export const FAILURE_EFFECT_MASTER = [
  '安全风险',        // 危及安全/法规
  '功能丧失',        // 产品功能失效/无法使用/顶不出
  '功能下降',        // 密封失效/效率下降/流量不足/压降超标
  '密封失效',        // 漏气/漏油/漏水/密封不严
  '异响NVH超标',     // 行车异响/机舱异响/共振/NVH超标
  '客户投诉',        // 装车投诉/外观评审不通过/客户端开裂抱怨
  '外观不良',        // 外观差/冷料斑/鱼鳞纹/客户不接受
  '报废率高',        // 零件失效报废/合格率低
  '寿命不足',        // 路试断裂/支架脱开/耐久不足
  '装配困难',        // 难装/装不到位/装车困难/装配干涉
  '质量损失',        // 返工/停线/批量质量问题
] as const;

export type FailureEffectMaster = (typeof FAILURE_EFFECT_MASTER)[number];

/** 同义词归并表：正则匹配 → 主词 */
export const FAILURE_MODE_SYNONYMS: Array<{ pattern: RegExp; master: FailureModeMaster }> = [
  { pattern: /破裂|断裂|开裂|裂纹|爆裂|破损|扯裂|扯断|拉断|折断|脱落\b(?!模)|脱开|分离|浮纤|掉出|脱出|撕裂/, master: '破裂' },
  { pattern: /内收缩|外鼓|翘曲|扭曲|变形\b|冷料斑|收缩形变|收缩变形|形变|鼓包|变形后/, master: '变形' },
  { pattern: /泄漏|泄露|漏气|漏油|漏水|渗|漏液|焊漏|有泄露|有泄漏/, master: '泄漏' },
  { pattern: /堵塞|堵死|卡滞|流通不畅|堵塞性|卡死/, master: '堵塞' },
  { pattern: /卡接.*不.*良|卡扣.*失效|弹起.*不足|回弹力.*(不够|不足)|卡接.*量.*少/, master: '卡滞' },
  { pattern: /异响|噪音|抖动|共振|碰擦|哒哒|哗啦|吱/, master: '异响' },
  { pattern: /腐蚀|老化|龟裂|粉化|锈蚀|氧化/, master: '腐蚀' },
  { pattern: /滑丝|脱扣|螺纹失效|抗旋.*(不足|不够)|螺牙.*(失效|坏)|螺母.*断|螺母.*拉/, master: '松动' },
  { pattern: /装配不到位|间隙过大|孔位偏差|错装|对位.*不准|偏孔|偏移|偏心|错位|轮廓.*不符|拔脱力.*(不足|不够|不满足)/, master: '错装' },
  { pattern: /干涉|打架|合模.*干涉|斜导柱.*干涉|运动.*干涉|结构.*干涉/, master: '干涉' },
  { pattern: /焊接.*(开裂|脱开|强度|不良|泄漏|泄露|不稳定|差)|脱焊|焊合.*不良|焊筋.*(错位|失效)|熔接.*断裂|熔接.*失效|超声波焊.*(坏|不良)|热板焊.*(坏|不良|裂)/, master: '焊合不良' },
  { pattern: /注塑.*(不良|缺料|溢料|熔接痕|尺寸|超差|浮纤|外观)|注塑缺料|溢料|尺寸超差|熔接痕|浮纤|外观.*(差|不良|不合格)|鱼鳞纹|冷料斑|吹塑.*(外观|差)|脏污|疤痕缺陷|缺胶|缺孔|破孔/, master: '注塑不良' },
  { pattern: /外观.*(差|不良|不合格|差异|不好)/, master: '外观不良' },
  { pattern: /密封.*(失效|不严|差)|流量.*(不足|不够)|压降.*(超|大)|效率.*(下降|低|不足|不够)|性能.*(下降|差)/, master: '性能下降' },
  { pattern: /路试.*(断|裂|脱)|疲劳|耐久.*(不足|不够|差)|寿命.*(短|不足|不够)|支架.*(断|脱)/, master: '寿命不足' },
];

export const FAILURE_CAUSE_SYNONYMS: Array<{ pattern: RegExp; master: FailureCauseMaster }> = [
  { pattern: /韧性.*(好|不够|差|不足)|PA6.*不适配|材料.*收缩.*(率|不匹配)|材料.*(耐温|耐热).*(不够|不足|差)|材料.*流动性.*(差|不好|不佳)/, master: '材料选型不当' },
  { pattern: /壁厚.*(薄|不足|不够|小)|加强筋.*(缺失|不够|不足)|薄壁|壁面.*面积.*大.*薄壁|没有加强筋/, master: '壁厚不足' },
  { pattern: /压缩量.*(小|不足|不够|偏小|不均)|过盈量.*(小|不足|不够|太小|偏小)|密封.*压缩|过盈.*太小/, master: '密封压缩量不足' },
  { pattern: /耐温.*(不够|不足|差)|高温.*(老化|失效)|低温.*(脆断|失效)|热稳定.*(差|不够)/, master: '材料耐温不够' },
  { pattern: /间隙.*(大|小|不够|不足)|空间.*(小|不足|不够)|回弹.*(空间|路径).*(不够|不足|大)|工装.*干涉|卡扣.*间隙/, master: '装配空间不足' },
  { pattern: /浇口.*(位置|不当|不佳)|流道.*(长|差|不佳)|熔接痕.*(受力|集中|在外侧|在开槽)|针阀.*浇口.*拉烂/, master: '流道设计不合理' },
  { pattern: /焊接.*温度.*(高|低|过高|不足)|加热.*(位置|方向).*(错|反|偏)|加热时间.*(短|不足)|焊接.*筋.*(错位|崩)|加热.*不.*到位/, master: '焊接工艺不当' },
  { pattern: /应力集中|开槽.*(削弱|失去)|结构.*(强度|设计|不良|问题)|熔接.*在.*(受力|外侧)|没有.*加强筋|结构.*不好|结构.*问题|结构.*不当|预埋.*下沉.*(不够|不足)|预埋.*法兰.*(薄|小)/, master: '结构设计不当' },
  { pattern: /孔.*偏|孔位.*偏差|椭圆.*(度|小)|轮廓.*不符|拔脱力.*(不足|不够)|尺寸.*超差|抗旋力矩.*(不足|不够)/, master: '尺寸超差' },
  { pattern: /模具.*(排气|设计|不良|问题)|口模.*(缺损|坏)|斜导柱.*干涉|射嘴.*碰缺|冷刀.*(不对|差|不良)|针阀.*拉烂|热流道.*浇口.*拉烂/, master: '模具设计不良' },
  { pattern: /打紧力.*(大|太大|超)|转速.*(高|太高)|压力.*(小|不足|不够)|温度.*(漂移|升|高|超)|扭矩.*(大|超)/, master: '工艺参数不当' },
  { pattern: /包装.*(防护|不良|不足|不够)|运输.*磕碰|标签.*(扯|破|差)|防护.*不足|防护.*不够|未.*防护/, master: '包装防护不足' },
  { pattern: /无.*(径向|防旋转|防脱|定位).*限位|没有.*(限位|定位|防脱)|防脱.*(筋|不足|不够)|定位.*结构.*(缺失|不足)/, master: '定位结构缺失' },
  { pattern: /表面.*(质量|差|不良)|冷刀.*(切|不好|差|不良)|吹塑.*(外观|差|不好)|鱼鳞.*纹|脏污|划痕|刮伤|疤痕/, master: '表面质量差' },
  { pattern: /预埋.*螺母|下沉.*(深度|不够|不足|1mm)|法兰.*(薄|小|强度)|抗旋.*(力矩|不足|不够)|螺母.*(拉|断)/, master: '预埋螺母问题' },
];

export const FAILURE_EFFECT_SYNONYMS: Array<{ pattern: RegExp; master: FailureEffectMaster }> = [
  { pattern: /危及.*(安全|法规)|安全.*风险|安全.*隐患|法规.*不.*(满足|通过)/, master: '安全风险' },
  { pattern: /功能.*(丧失|失效|无法使用|坏|不行)|无法使用|功能.*不好|顶不出|不能.*(用|装)|产品.*失效/, master: '功能丧失' },
  { pattern: /功能.*下降|效率.*下降|流量.*(不足|不够)|压降.*(大|超)|性能.*下降|清洁度.*(差|不够)/, master: '功能下降' },
  { pattern: /密封.*(失效|不严|差|不好)|漏.*(气|油|水)|密封.*不够|密封.*不良/, master: '密封失效' },
  { pattern: /异响|噪音|共振|NVH|抖动|机舱.*响|行车.*响|NVH.*(超|差)/, master: '异响NVH超标' },
  { pattern: /客户.*(投诉|抱怨|不接受|不通过|反馈)|装车.*投诉|客户端.*(抱怨|开裂|投诉)/, master: '客户投诉' },
  { pattern: /外观.*(不良|差|不合格|不通过|不好)|外观.*不.*(接受|合格|通过)|鱼鳞|冷料斑/, master: '外观不良' },
  { pattern: /报废|合格率.*(低|差)|不合格|返工|报废率|质量.*损失/, master: '报废率高' },
  { pattern: /路试.*(断|裂|脱|失效)|耐久.*(差|不足|不够)|支架.*(断|脱)|寿命.*(短|差)/, master: '寿命不足' },
  { pattern: /难装|装.*困难|装不到位|装车.*困难|装配.*干涉|装配.*不.*(好|顺|到位)/, master: '装配困难' },
  { pattern: /批量.*(问题|故障)|停线|批量.*质量|质量.*问题.*批量|漏油.*客户.*抱怨/, master: '质量损失' },
];

/** 文本归一：去多余空白、全半角数字统一、常见杂项词替换 */
export function normalizeRawText(text: string): string {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/[，。；：]/g, (m) => ({ '，': ',', '。': '.', '；': ';', '：': ':' }[m]!))
    .trim();
}

/** 从文本中提取候选主词（返回第一个匹配，无匹配则 null） */
function matchMaster<T extends readonly string[]>(
  text: string,
  table: Array<{ pattern: RegExp; master: T[number] }>,
): T[number] | null {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const { pattern, master } of table) {
    if (pattern.test(text) || pattern.test(lower)) {
      return master as T[number];
    }
  }
  return null;
}

/** 失效模式归并：返回主词 + 原词（原词为空时表示原文本身就是主词） */
export function normalizeFailureMode(text: string): { master: FailureModeMaster | null; raw: string } {
  const raw = normalizeRawText(text);
  if (!raw) return { master: null, raw: '' };
  const m = matchMaster(raw, FAILURE_MODE_SYNONYMS);
  return { master: m as FailureModeMaster | null, raw };
}

export function normalizeFailureCause(text: string): { master: FailureCauseMaster | null; raw: string } {
  const raw = normalizeRawText(text);
  if (!raw) return { master: null, raw: '' };
  const m = matchMaster(raw, FAILURE_CAUSE_SYNONYMS);
  return { master: m as FailureCauseMaster | null, raw };
}

export function normalizeFailureEffect(text: string): { master: FailureEffectMaster | null; raw: string } {
  const raw = normalizeRawText(text);
  if (!raw) return { master: null, raw: '' };
  const m = matchMaster(raw, FAILURE_EFFECT_SYNONYMS);
  return { master: m as FailureEffectMaster | null, raw };
}

/** 自动归并整张草稿的失效相关字段 */
export interface FmeaDraftNormalized {
  failureModeMaster: FailureModeMaster | null;
  failureModeRaw: string;
  failureCauseMaster: FailureCauseMaster | null;
  failureCauseRaw: string;
  failureEffectMaster: FailureEffectMaster | null;
  failureEffectRaw: string;
}

export function normalizeFmeaDraft(failureMode: string, failureCause: string, failureEffect: string): FmeaDraftNormalized {
  const m = normalizeFailureMode(failureMode);
  const c = normalizeFailureCause(failureCause);
  const e = normalizeFailureEffect(failureEffect);
  return {
    failureModeMaster: m.master,
    failureModeRaw: m.raw,
    failureCauseMaster: c.master,
    failureCauseRaw: c.raw,
    failureEffectMaster: e.master,
    failureEffectRaw: e.raw,
  };
}
