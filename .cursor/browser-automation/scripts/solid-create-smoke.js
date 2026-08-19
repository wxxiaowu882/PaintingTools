const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const runsRoot = path.resolve(__dirname, '..', 'runs');
const taskName = 'solid-create-smoke';
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outputDir = path.join(runsRoot, `${stamp}-${taskName}`);
const baseUrl = process.env.BASE_URL || 'http://localhost:18080';
const relPath = '自用工具文件_不部署/石膏人像沙盒场景生成/Solid_Portrait_Create.html';
const relUrl = relPath
  .split('/')
  .map((seg) => encodeURIComponent(seg))
  .join('/');
const targetUrl = `${baseUrl}/${relUrl}`;

async function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

async function cleanOldRunsExcept(keepDir) {
  if (!fs.existsSync(runsRoot)) return;
  for (const name of fs.readdirSync(runsRoot)) {
    const full = path.join(runsRoot, name);
    if (!fs.existsSync(full)) continue;
    if (full === keepDir) continue;
    fs.rmSync(full, { recursive: true, force: true });
  }
}

async function shot(page, fileName) {
  await page.screenshot({ path: path.join(outputDir, fileName) });
}

async function main() {
  // 为了“临时文件即时清理”：每次运行只保留本次 runs/ 输出。
  await cleanOldRunsExcept(outputDir);
  await ensureDir(outputDir);
  const browser = await chromium.launch({ channel: 'chrome', headless: false, slowMo: 400 });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1400, height: 900 });

  try {
    await page.goto(targetUrl);
    await page.waitForSelector('#scene-loader', { state: 'hidden', timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(1500);
    await page.waitForSelector('button[onclick="createNewScene()"]', { timeout: 60000 });

    // 用 onclick + id 这种稳定选择器，避免文字匹配超时/被遮罩导致点击失败
    await page.click('button[onclick="createNewScene()"]');
    await page.waitForTimeout(1200);
    const nameInput = await page.$('#scene-name-input');
    await nameInput.fill('自动化测试场景');
    await shot(page, '01-scene-created.png');

    await page.click('button[onclick="openBuiltinModal()"]');
    await page.waitForTimeout(1200);
    await page.waitForSelector('text=球', { timeout: 60000 });
    await page.click('text=球');
    await page.waitForTimeout(2000);
    await shot(page, '02-sphere-added.png');

    await page.selectOption('#tool-mode-select', 'annotate');
    await page.waitForTimeout(600);

    const canvasBox = await page.evaluate(() => {
      const container = document.querySelector('#canvas-container');
      const rect = container.getBoundingClientRect();
      return { x: rect.x, y: rect.y, w: rect.width, h: rect.height };
    });
    const fromX = canvasBox.x + canvasBox.w * 0.5;
    const fromY = canvasBox.y + canvasBox.h * 0.38;
    const toX = fromX + 130;
    const toY = fromY - 100;

    await page.keyboard.down('Alt');
    await page.keyboard.down('Shift');
    await page.mouse.move(fromX, fromY);
    await page.mouse.down();
    for (let i = 1; i <= 20; i += 1) {
      await page.mouse.move(
        fromX + ((toX - fromX) * i) / 20,
        fromY + ((toY - fromY) * i) / 20,
        { steps: 1 }
      );
      await page.waitForTimeout(20);
    }
    await page.mouse.up();
    await page.keyboard.up('Shift');
    await page.keyboard.up('Alt');
    await page.waitForTimeout(1800);
    await shot(page, '03-annotation-drawn.png');

    const annoLabel = await page.$('.anno-dom .anno-leader-label, .anno-dom');
    if (annoLabel) {
      await annoLabel.dblclick();
      await page.waitForTimeout(500);
      await page.keyboard.press('Control+a');
      await page.keyboard.type('测试标注：高光区');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(600);
    }
    await shot(page, '04-final.png');
    console.log(`Smoke task finished. Output: ${path.relative(repoRoot, outputDir)}`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
