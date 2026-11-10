/**
 * 标准版公式简介：每条约 20~40 字，只说明公式的主要用途。
 * 科研版仍展示完整的 summary；标准版在公式库与计算页使用 briefOf()。
 */
export const FORMULA_BRIEFS: Record<string, string> = {
  'acoustics.muffler.expansion': '计算膨胀腔消音器的传递损失与消声性能。',
  'acoustics.muffler.helmholtz': '计算亥姆霍兹消音器的共振频率与传递损失。',
  'acoustics.intakeSystemTransmissionLoss': '评估进气系统各段声学传递损失与总消声量。',
  'acoustics.muffler.multiCavity': '计算多腔穿孔消音器各腔传递损失与总消声量。',
  'acoustics.muffler.quarterWave': '计算四分之一波长管的消声频率与传递损失。',
  'acoustics.muffler.wovenTube': '计算编织管消音器的声学传递损失。',
  'fluid.intakeSystemResistance': '计算进气系统各段压降与总阻力，输出阻力曲线。',
  'fluid.filter.porous-media-fitting': '拟合多孔介质黏性与惯性阻力系数，供滤芯压降计算使用。',
  'fluid.pressureCorrection': '按温度、海拔与湿度修正空气密度与压力。',
  'structure.airFilter.element': '按褶皱几何设计滤芯，计算清洁压降与容尘压降。',
  'structure.intakeHoseFull': '由装配空间反算橡胶进气软管的全几何参数。',
};

/** 标准版简介：优先取人工精简文案，缺失时截取原摘要首句并压到 50 字以内 */
export function briefOf(formula: { id: string; summary: string }): string {
  const text = FORMULA_BRIEFS[formula.id] || formula.summary;
  const firstSentence = text.split(/[。；]/)[0];
  return firstSentence.length > 50 ? `${firstSentence.slice(0, 49)}…` : firstSentence;
}
