import { describe, expect, it } from 'vitest';
import {
  KBE_DOCS,
  KBE_DOC_ACCEPT,
  inferKbeDocCategory,
  kbeDocConfig,
  parseKbeDocFileName,
  todayKbeDocDate,
} from '../src/report/kbeDoc';

describe('知识经验库资料元数据', () => {
  it('四类资料均配置目录、编号前缀与专属字段', () => {
    for (const key of ['standards', 'guidelines', 'lessons', 'papers'] as const) {
      const cfg = kbeDocConfig(key);
      expect(cfg.key).toBe(key);
      expect(cfg.dirName.length).toBeGreaterThan(0);
      expect(cfg.idPrefix).toMatch(/^[A-Z]{2,4}$/);
      expect(cfg.fields.length).toBeGreaterThan(0);
      expect(cfg.kinds.length).toBeGreaterThan(0);
    }
    expect(KBE_DOCS.standards.idPrefix).toBe('STD');
    expect(KBE_DOCS.papers.idPrefix).toBe('PT');
  });

  it('标准状态的取值都在下拉字典内，避免徽标出现未知值', () => {
    const status = KBE_DOCS.standards.fields.find((f) => f.key === 'status');
    expect(status?.options).toEqual(['现行', '即将实施', '征求意见', '作废']);
    for (const cfg of Object.values(KBE_DOCS)) {
      for (const f of cfg.fields.filter((x) => x.badge)) {
        expect(f.options && f.options.length).toBeTruthy();
      }
    }
  });

  it('从文件名识别标准号（含斜杠与空格写法）', () => {
    expect(parseKbeDocFileName('GB/T 28949-2025 内燃机空气滤清器 性能试验.pdf').extras.stdNo).toBe(
      'GB/T 28949-2025',
    );
    expect(parseKbeDocFileName('QC T 32-2017 汽车用空气滤清器.docx').extras.stdNo).toBe('QC/T 32-2017');
    expect(parseKbeDocFileName('进气系统流阻设计指南.pdf').extras.stdNo).toBeUndefined();
  });

  it('识别资料名与日期，日期缺省回落到今天', () => {
    const draft = parseKbeDocFileName('2025-03-18 滤芯压降试验报告.pdf');
    expect(draft.title).toContain('滤芯压降试验报告');
    expect(draft.publishedAt).toBe('2025-03-18');
    expect(todayKbeDocDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('导入格式覆盖 PPT / Word / PDF', () => {
    for (const ext of ['.pdf', '.doc', '.docx', '.ppt', '.pptx']) {
      expect(KBE_DOC_ACCEPT.split(',')).toContain(ext);
    }
  });

  it('标准提供业务领域字段，导入行可直接选择并可按其筛选', () => {
    const domain = KBE_DOCS.standards.fields.find((f) => f.key === 'domain');
    expect(domain?.options).toEqual(['产品设计', '包装设计', '试验测试', '环保要求']);
    expect(domain?.importInRow).toBe(true);
    expect(domain?.filterInList).toBe(true);
  });

  it('按文件名推断细分类别，识别不出时留空由用户选择', () => {
    expect(inferKbeDocCategory('GB/T 28949-2025 内燃机空气滤清器.pdf', 'standards')).toBe('国家标准');
    expect(inferKbeDocCategory('QC/T 32-2017 汽车用空气滤清器.pdf', 'standards')).toBe('行业标准');
    expect(inferKbeDocCategory('ISO 5011-2025 Air cleaners.pdf', 'standards')).toBe('法规/认证');
    expect(inferKbeDocCategory('某企标 Q/CA 123-2024.pdf', 'standards')).toBe('企业标准');
    expect(inferKbeDocCategory('进气系统设计要求.pdf', 'standards')).toBe('');

    expect(inferKbeDocCategory('滤芯选型指南.pdf', 'guidelines')).toBe('选型指南');
    expect(inferKbeDocCategory('设计评审流程.pdf', 'guidelines')).toBe('流程规范');

    expect(inferKbeDocCategory('滤芯端盖开裂失效分析.pdf', 'lessons')).toBe('失效案例');
    expect(inferKbeDocCategory('客户抱怨滤芯压降偏高.pdf', 'lessons')).toBe('客户反馈');

    expect(inferKbeDocCategory('一种褶皱滤芯专利 CN1234567A.pdf', 'papers')).toBe('专利');
    expect(inferKbeDocCategory('SAE 2025 会议论文.pdf', 'papers')).toBe('会议论文');
    expect(inferKbeDocCategory('某材料研究报告.pdf', 'papers')).toBe('技术报告');
    expect(inferKbeDocCategory('滤材阻力特性论文.pdf', 'papers')).toBe('技术论文');
  });
});
