import { describe, expect, it } from 'vitest';
import {
  DEFAULT_KEYWORDS,
  buildTestXlsxBase64,
  normalizeCustomer,
  parseHeaderCode,
  parseMetaOnly,
  parseTestReport,
  testReportFileName,
} from '../src/report/testReport';

/**
 * 实验报告解析与 Excel 导出测试
 *
 * 用一段模拟的文字版报告正文验证：项目/产品/版本/日期识别、
 * 关键字抓取测试项、文件名规则与工作簿生成。
 */
const SAMPLE = `长安 CS75-2025 空气滤清器总成 实验报告
项目名称：长安 CS75-2025
产品名称：空气滤清器总成
版本号：V1.2
报告日期：2026年10月20日

3 测试结果
噪声测试：声压级 78.5 dB(A)，转速=1500 r/min，判定：合格
压降测试：压力降 1.25 kPa，流量=600 m³/h，判定：合格
传递损失 32.5 dB，判定=合格
备注：本报告仅用于内部评审
`;

describe('实验报告解析', () => {
  const parsed = parseTestReport(SAMPLE, 'report.pdf', DEFAULT_KEYWORDS);

  it('识别项目 / 产品 / 版本 / 日期', () => {
    expect(parsed.meta.project).toBe('长安 CS75-2025');
    expect(parsed.meta.product).toBe('空气滤清器总成');
    expect(parsed.meta.version).toBe('V1.2');
    expect(parsed.meta.date).toBe('2026-10-20');
  });

  it('按关键字识别测试项与实测值', () => {
    const byName = new Map(parsed.items.map((i) => [i.name, i]));
    expect(byName.get('声压级')?.resultText).toContain('实测值=78.5 dB(A)');
    expect(byName.get('声压级')?.conditionText).toContain('转速=1500 r/min');
    expect(byName.get('压力降')?.resultText).toContain('实测值=1.25 kPa');
    expect(byName.get('压力降')?.resultText).toContain('判定=合格');
    expect(byName.get('传递损失')?.resultText).toContain('实测值=32.5 dB');
    // 长关键字优先，不应同时出现「压降」重复行
    expect(byName.has('压降')).toBe(false);
  });

  it('文件名规则：项目+产品名+版本号+日期', () => {
    expect(testReportFileName(parsed.meta)).toBe('长安 CS75-2025+空气滤清器总成+V1.2+20261020.xlsx');
  });

  it('生成有效的 xlsx 工作簿（zip 头 + 非空）', async () => {
    const b64 = await buildTestXlsxBase64(parsed.meta, parsed.items);
    expect(b64.startsWith('UEsDB')).toBe(true); // PK\x03\x04
    expect(b64.length).toBeGreaterThan(4000);
  });
});

describe('页眉编号识别（SYZX-客户 年月日 流水）', () => {
  // 年份后两位按电脑当前年份的世纪补齐：26 → 20xx（与 parseHeaderCode 同规则计算期望值）
  const expectedYear = (() => {
    const now = new Date().getFullYear();
    let y = Math.floor(now / 100) * 100 + 26;
    if (y > now) y -= 100;
    return y;
  })();

  it('识别客户与日期，年份补齐前两位', () => {
    const r = parseHeaderCode('SYZX-BYD 26 07 01 01\n某实验报告正文');
    expect(r).not.toBeNull();
    expect(r!.customer).toBe('BYD');
    expect(r!.date).toBe(`${expectedYear}-07-01`);
  });

  it('页眉编号优先于正文标签（客户与日期）', () => {
    const meta = parseMetaOnly(
      'SYZX-BYD 26 07 01 01\n客户：其他客户\n报告日期：2020年1月2日',
      'x.pdf',
    );
    expect(meta.customer).toBe('BYD');
    expect(meta.date).toBe(`${expectedYear}-07-01`);
  });

  it('无页眉编号时回退到原有标签识别', () => {
    const meta = parseMetaOnly(SAMPLE, 'x.pdf');
    expect(meta.customer).toBe('');
    expect(meta.date).toBe('2026-10-20');
  });

  it('非法月份/日期不识别', () => {
    expect(parseHeaderCode('SYZX-BYD 26 13 40 01')).toBeNull();
    expect(parseHeaderCode('SYZX-BYD 26 00 10 01')).toBeNull();
  });

  it('编号在正文深处（超过页眉前 10 行）不识别', () => {
    const body = Array.from({ length: 15 }, (_, i) => `第${i + 1}行内容`).join('\n');
    expect(parseHeaderCode(`报告标题\n${body}\nSYZX-BYD 26 07 01 01`)).toBeNull();
  });
});

describe('客户名称规范化（读到 XX汽车 为止）', () => {
  it('去掉「股份有限公司」等公司后缀', () => {
    expect(normalizeCustomer('长城汽车股份有限公司')).toBe('长城汽车');
    expect(normalizeCustomer('重庆长安汽车股份有限公司')).toBe('重庆长安汽车');
  });

  it('名称中不含「汽车」时保持原样', () => {
    expect(normalizeCustomer('比亚迪股份有限公司')).toBe('比亚迪股份有限公司');
    expect(normalizeCustomer('')).toBe('');
  });

  it('从封面「客户名称」标签提取并规范化', () => {
    const meta = parseMetaOnly(
      '某实验报告封面\n客户名称：长城汽车股份有限公司\n产品名称：空气滤清器',
      'x.pdf',
    );
    expect(meta.customer).toBe('长城汽车');
  });

  it('页眉编号客户优先，不受规范化影响', () => {
    const meta = parseMetaOnly('SYZX-BYD 26 07 01 01\n客户名称：长城汽车股份有限公司', 'x.pdf');
    expect(meta.customer).toBe('BYD');
  });
});
