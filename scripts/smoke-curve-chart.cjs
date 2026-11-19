/**
 * 曲线图冒烟测试（回归防护）
 *
 * 背景：CalculatorPage 中结果曲线图与参数敏感性分析曾共用同一个 React key，
 * 触发 React 重复 key，导致每次计算都新增一张曲线图 DOM（4 → 8 → 12 → 16）。
 *
 * 本脚本用真实浏览器打开带结果曲线的公式，连续修改输入，断言：
 *   1. 任何时刻页面只有 1 张曲线图、1 个图表容器、1 张画布；
 *   2. 控制台没有 “same key” 重复 key 警告。
 *
 * 用法：npm run test:smoke
 * 依赖：本机安装 Chrome 或 Edge；脚本自行在 5199 端口启动 vite 并在结束后关闭。
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');

const ROOT = path.resolve(__dirname, '..');
const PORT = 5199;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const FORMULA_TITLE = '进气系统阻力设计';
const FLOW_PARAM_LABEL = '系统体积流量';
const FLOW_VALUES = ['280', '320', '300'];

const BROWSER_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];

function findBrowser() {
  return BROWSER_CANDIDATES.find((p) => fs.existsSync(p));
}

async function waitForServer(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(BASE_URL);
      if (res.ok) return;
    } catch {
      /* 服务尚未就绪，继续等待 */
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`开发服务未在 ${timeoutMs}ms 内就绪：${BASE_URL}`);
}

function startVite() {
  const viteBin = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  return spawn(
    process.execPath,
    [viteBin, '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
    { cwd: ROOT, stdio: 'ignore' },
  );
}

async function clickByText(page, text) {
  const el = await page.waitForSelector(
    `::-p-xpath(//button[contains(normalize-space(.), "${text}")])`,
    { visible: true, timeout: 15000 },
  );
  await el.click();
}

async function readChartState(page) {
  return page.evaluate(() => ({
    curveBlocks: document.querySelectorAll('.curve-block').length,
    containers: document.querySelectorAll('.curve-block .sens-chart').length,
    canvases: Array.from(document.querySelectorAll('.curve-block .sens-chart')).map(
      (el) => el.querySelectorAll('canvas').length,
    ),
  }));
}

function assertSingleChart(state, step, failures) {
  if (state.curveBlocks !== 1) failures.push(`${step}：期望 1 张曲线图，实际 ${state.curveBlocks} 张`);
  if (state.containers !== 1) failures.push(`${step}：期望 1 个图表容器，实际 ${state.containers} 个`);
  if (state.canvases.some((count) => count !== 1)) {
    failures.push(`${step}：画布数量异常 ${JSON.stringify(state.canvases)}`);
  }
}

(async () => {
  const executablePath = findBrowser();
  if (!executablePath) throw new Error('未找到 Chrome 或 Edge，无法执行冒烟测试');

  const vite = startVite();
  let browser;
  const failures = [];
  let duplicateKeyWarnings = 0;

  try {
    await waitForServer(30000);
    browser = await puppeteer.launch({
      executablePath,
      headless: true,
      args: ['--no-sandbox'],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1000 });
    page.on('console', (msg) => {
      if (/same key/i.test(msg.text())) duplicateKeyWarnings += 1;
    });

    await page.goto(BASE_URL, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.waitForSelector('input[placeholder="用户名"]');
    await page.type('input[placeholder="用户名"]', 'demo');
    await page.type('input[placeholder="密码"]', '123456');
    await page.click('button.btn-primary');

    await clickByText(page, '产品理论设计');
    await clickByText(page, '公式库');
    const card = await page.waitForSelector(
      `::-p-xpath(//article[contains(@class,"formula-card") and .//h4[contains(normalize-space(.),"${FORMULA_TITLE}")]])`,
      { visible: true, timeout: 15000 },
    );
    await card.click();
    await page.waitForSelector('.curve-block canvas', { visible: true, timeout: 15000 });
    await new Promise((resolve) => setTimeout(resolve, 400));
    assertSingleChart(await readChartState(page), '首次打开', failures);

    const input = await page.waitForSelector(
      `::-p-xpath(//div[contains(@class,"param-row")][.//*[contains(normalize-space(.),"${FLOW_PARAM_LABEL}")]]//input[@type="number"])`,
      { visible: true, timeout: 15000 },
    );
    for (const [index, value] of FLOW_VALUES.entries()) {
      await input.click({ clickCount: 3 });
      await page.keyboard.down('Control');
      await page.keyboard.press('a');
      await page.keyboard.up('Control');
      await page.keyboard.type(value);
      // 等待输入防抖（150ms）与图表重绘完成
      await new Promise((resolve) => setTimeout(resolve, 600));
      assertSingleChart(await readChartState(page), `第 ${index + 1} 次修改 Q=${value}`, failures);
    }

    if (duplicateKeyWarnings > 0) {
      failures.push(`控制台出现 ${duplicateKeyWarnings} 次重复 key 警告`);
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    try {
      vite.kill();
    } catch {
      /* 进程已退出 */
    }
  }

  if (failures.length > 0) {
    console.error('曲线图冒烟测试失败：');
    for (const item of failures) console.error(` - ${item}`);
    process.exitCode = 1;
    return;
  }
  console.log('曲线图冒烟测试通过：首次打开及连续 3 次修改后均只有 1 张曲线图，且无重复 key 警告。');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
