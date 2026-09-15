/**
 * 贝塞尔交互验收：建线 → 有 C 曲线 → 显示柄 → 投面 → 取消投面
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const PORT = process.env.PORT || '18080';
const ROOT = path.resolve(__dirname, '../../..');
const OUT = path.resolve(__dirname, '../runs');
const TOOL = `http://127.0.0.1:${PORT}/${encodeURI('自用工具文件_不部署/模型标注生产工具.html')}`;
const JSON_PATH = path.join(ROOT, 'docs/json/结构_五官/05 五官综合讲解.json');

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERT: ' + msg);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(TOOL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('#workbench-viewer', { timeout: 30000 });
  await page.waitForTimeout(600);
  await page.locator('#file-input').setInputFiles(JSON_PATH);
  await page.waitForTimeout(2500);

  await page.selectOption('#tool-mode-select', 'bezier');
  const box = await page.locator('#workbench-viewer').boundingBox();
  const cx = box.x + box.width * 0.48;
  const cy = box.y + box.height * 0.38;

  async function altShiftClick(x, y) {
    await page.keyboard.down('Alt');
    await page.keyboard.down('Shift');
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.waitForTimeout(30);
    await page.mouse.up();
    await page.keyboard.up('Shift');
    await page.keyboard.up('Alt');
    await page.waitForTimeout(120);
  }

  await altShiftClick(cx - 55, cy);
  await altShiftClick(cx + 70, cy + 45);
  await page.waitForTimeout(600);

  const created = await page.evaluate(() => {
    const b = pointsData.filter((p) => p.type === 'bezier').pop();
    const svg = document.querySelector('#ink-overlay');
    const d = [...svg.querySelectorAll('path[data-bezier-id]')].map((p) => p.getAttribute('d') || '')[0] || '';
    return {
      id: b && b.id,
      selected: selectedPointId,
      d,
      hasC: /C\s/.test(d),
      hasZeroC: /C\s+0(\.0+)?\s+0(\.0+)?\s+0(\.0+)?\s+0/.test(d),
      anchors: svg.querySelectorAll('.bezier-anchor-hit').length,
      handles: svg.querySelectorAll('.bezier-handle-hit').length,
      btn: document.getElementById('bezier-project-btn').textContent.trim(),
      disabled: document.getElementById('bezier-project-btn').disabled
    };
  });
  console.log('CREATED', JSON.stringify(created, null, 2));
  assert(created.id, '应创建贝塞尔');
  assert(created.selected === created.id, '应选中新建曲线');
  assert(created.hasC, '路径应含三次贝塞尔 C');
  assert(!created.hasZeroC, '控制点不能是 0,0');
  assert(created.anchors >= 2, '应显示锚点');
  assert(created.handles >= 1, '选中后应显示控制柄');
  assert(!created.disabled && created.btn.indexOf('投到面') >= 0, '投到面按钮可用');
  await page.screenshot({ path: path.join(OUT, 'bezier-qa-create.png') });

  // 拖柄改形
  const handleBox = await page.locator('.bezier-handle-hit').first().boundingBox();
  assert(handleBox, '应能定位控制柄');
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleBox.x + 40, handleBox.y - 35, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(400);

  const afterDrag = await page.evaluate(() => {
    const b = pointsData.find((p) => p.id === selectedPointId);
    const d = [...document.querySelectorAll('#ink-overlay path[data-bezier-id]')].map((p) => p.getAttribute('d') || '')[0] || '';
    return { handleOut: b && b.dots[0].handleOut, d, hasC: /C\s/.test(d) };
  });
  console.log('AFTER_DRAG', JSON.stringify(afterDrag, null, 2));
  assert(afterDrag.hasC, '拖柄后仍为 C 曲线');
  await page.screenshot({ path: path.join(OUT, 'bezier-qa-drag.png') });

  // 投到面
  const proj = await page.evaluate(() => window.BezierAnnotation.projectSelectedToSurface());
  console.log('PROJECT', proj);
  assert(proj.ok, '投面应成功: ' + JSON.stringify(proj));
  await page.waitForTimeout(300);
  const afterProj = await page.evaluate(() => {
    const b = pointsData.find((p) => p.id === selectedPointId);
    return {
      projected: b.projected,
      dots: b.dots.length,
      btn: document.getElementById('bezier-project-btn').textContent.trim(),
      d: [...document.querySelectorAll('#ink-overlay path[data-bezier-id]')].map((p) => p.getAttribute('d') || '')[0] || ''
    };
  });
  console.log('AFTER_PROJ', afterProj);
  assert(afterProj.projected === true, 'projected 应为 true');
  assert(afterProj.dots >= 3, '投面后应有多点');
  assert(afterProj.btn.indexOf('取消投面') >= 0, '按钮应变取消投面');
  await page.screenshot({ path: path.join(OUT, 'bezier-qa-project.png') });

  // 取消投面
  const un = await page.evaluate(() => window.BezierAnnotation.unprojectSelected());
  assert(un.ok, '取消投面应成功');
  await page.waitForTimeout(400);
  const afterUn = await page.evaluate(() => {
    const b = pointsData.find((p) => p.id === selectedPointId);
    const d = [...document.querySelectorAll('#ink-overlay path[data-bezier-id]')].map((p) => p.getAttribute('d') || '')[0] || '';
    return { projected: !!b.projected, dots: b.dots.length, hasC: /C\s/.test(d), handles: !!b.dots[0].handleOut };
  });
  console.log('AFTER_UN', afterUn);
  assert(afterUn.dots === 2, '取消投面应回到两点');
  assert(afterUn.hasC || afterUn.handles, '应恢复可编辑柄');
  await page.screenshot({ path: path.join(OUT, 'bezier-qa-unproject.png') });

  fs.writeFileSync(path.join(OUT, 'bezier-qa-result.json'), JSON.stringify({ created, afterDrag, proj, afterProj, afterUn }, null, 2));
  await browser.close();
  console.log('QA_PASS');
}

main().catch((e) => { console.error(e); process.exit(1); });
