import { describe, expect, it } from 'vitest';
import {
  DEFAULT_KEYWORDS,
  buildTestXlsxBase64,
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
