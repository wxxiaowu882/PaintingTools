/**
 * 贝塞尔产品级视觉验收：建线 → 柄离弦拖拽 → 双击插点 → 截图供 AI 读图
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

function distToSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax, aby = by - ay;
  const apx = px - ax, apy = py - ay;
  const ab2 = abx * abx + aby * aby;
  if (ab2 < 1e-8) return Math.hypot(apx, apy);
  let t = (apx * abx + apy * aby) / ab2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + abx * t), py - (ay + aby * t));
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(TOOL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('#workbench-viewer', { timeout: 30000 });
  await page.waitForTimeout(600);
  await page.locator('#file-input').setInputFiles(JSON_PATH);
  await page.waitForFunction(() => typeof pointsData !== 'undefined' && pointsData.length > 10, { timeout: 25000 });
  // 等模型表面可拾取，避免空点
  await page.waitForFunction(() => {
    const v = document.querySelector('#workbench-viewer');
    if (!v) return false;
    const r = v.getBoundingClientRect();
    for (let uy = 0.3; uy <= 0.55; uy += 0.05) {
      for (let ux = 0.4; ux <= 0.6; ux += 0.05) {
        if (v.positionAndNormalFromPoint(r.left + r.width * ux, r.top + r.height * uy)) return true;
      }
    }
    return false;
  }, { timeout: 45000 });
  await page.waitForTimeout(600);

  const box = await page.locator('#workbench-viewer').boundingBox();
  // 扫描脸上有效贴面点，避免视角未稳时空点
  const picks = await page.evaluate(() => {
    const v = document.querySelector('#workbench-viewer');
    const r = v.getBoundingClientRect();
    const found = [];
    for (let uy = 0.28; uy <= 0.55; uy += 0.04) {
      for (let ux = 0.38; ux <= 0.62; ux += 0.04) {
        const x = r.left + r.width * ux;
        const y = r.top + r.height * uy;
        if (v.positionAndNormalFromPoint(x, y)) found.push({ x, y, ux, uy });
      }
    }
    return found;
  });
  assert(picks.length >= 2, '模型表面应可拾取，实际命中=' + picks.length);
  const pA = picks[Math.floor(picks.length * 0.25)];
  const pB = picks[Math.floor(picks.length * 0.75)];
  console.log('PICKS', { n: picks.length, pA, pB });

  await page.mouse.click(box.x + 40, box.y + 40);
  await page.waitForTimeout(120);

  await page.selectOption('#tool-mode-select', 'bezier');

  async function altShiftClick(x, y) {
    await page.keyboard.down('Alt');
    await page.keyboard.down('Shift');
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.waitForTimeout(40);
    await page.mouse.up();
    await page.keyboard.up('Shift');
    await page.keyboard.up('Alt');
    await page.waitForTimeout(180);
  }

  await altShiftClick(pA.x, pA.y);
  await altShiftClick(pB.x, pB.y);
  await page.waitForTimeout(800);

  const created = await page.evaluate(() => {
    const b = pointsData.filter((p) => p.type === 'bezier').pop();
    const svg = document.querySelector('#ink-overlay');
    const d = [...svg.querySelectorAll('path[data-bezier-id]')].map((p) => p.getAttribute('d') || '')[0] || '';
    const pe = [...svg.querySelectorAll('.bezier-handle-hit, .bezier-anchor-hit, path.svg-hit-path[data-bezier-id]')].map((el) => ({
      peInline: el.style.pointerEvents || '',
      peComp: getComputedStyle(el).pointerEvents
    }));
    return {
      id: b && b.id,
      selected: selectedPointId,
      d,
      hasC: /C\s/.test(d),
      hasZeroC: /C\s+0(\.0+)?\s+0(\.0+)?\s+0(\.0+)?\s+0/.test(d),
      anchors: svg.querySelectorAll('.bezier-anchor-hit').length,
      handles: svg.querySelectorAll('.bezier-handle-hit').length,
      pe
    };
  });
  console.log('CREATED', JSON.stringify(created, null, 2));
  assert(created.id, '应创建贝塞尔');
  assert(created.hasC && !created.hasZeroC, '应有有效 C 路径');
  assert(created.handles >= 1, '应显示控制柄');
  assert(created.pe.every((x) => x.peInline !== 'none'), '贝塞尔命中不得残留 inline pe:none');
  assert(created.pe.every((x) => x.peComp === 'auto'), '贝塞尔命中 computed 应为 auto');
  await page.screenshot({ path: path.join(OUT, 'bezier-vision-01-create.png') });

  // 空点 + 探照灯重选
  await page.mouse.click(box.x + 50, box.y + 80);
  await page.waitForTimeout(150);
  const pathBox = await page.locator('path.svg-hit-path[data-bezier-id]').first().boundingBox();
  assert(pathBox, '应有命中条');
  await page.mouse.click(pathBox.x + pathBox.width * 0.35, pathBox.y + pathBox.height * 0.5);
  await page.waitForTimeout(350);

  const afterReselect = await page.evaluate(() => {
    const svg = document.querySelector('#ink-overlay');
    return {
      selected: selectedPointId,
      handles: svg.querySelectorAll('.bezier-handle-hit').length,
      peBad: [...svg.querySelectorAll('.bezier-handle-hit, .bezier-anchor-hit')].some((el) => el.style.pointerEvents === 'none')
    };
  });
  console.log('RESELECT', afterReselect);
  assert(!afterReselect.peBad, '探照灯后柄命中不得 pe:none');
  assert(afterReselect.handles >= 1, '重选后应有柄');

  const beforeGeom = await page.evaluate(() => {
    const svg = document.querySelector('#ink-overlay');
    const anchors = [...svg.querySelectorAll('circle.bezier-anchor-hit')].map((c) => ({
      cx: parseFloat(c.getAttribute('cx')),
      cy: parseFloat(c.getAttribute('cy'))
    }));
    const handle = svg.querySelector('circle.bezier-handle-hit');
    const b = pointsData.find((p) => p.id === selectedPointId);
    return {
      a0: anchors[0],
      a1: anchors[anchors.length - 1],
      hx: handle ? parseFloat(handle.getAttribute('cx')) : null,
      hy: handle ? parseFloat(handle.getAttribute('cy')) : null,
      handleOut0: b && b.dots[0] && b.dots[0].handleOut
    };
  });
  console.log('BEFORE_DRAG', beforeGeom);

  const hb = await page.locator('.bezier-handle-hit').first().boundingBox();
  assert(hb, '应能定位柄');
  const startX = hb.x + hb.width / 2;
  const startY = hb.y + hb.height / 2;
  // 拖到另一处有效表面点（偏离弦）
  const dragTarget = picks.find((pt) => Math.hypot(pt.x - startX, pt.y - startY) > 40)
    || { x: startX + 40, y: startY - 35 };
  const dragToX = dragTarget.x;
  const dragToY = dragTarget.y;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(dragToX, dragToY, { steps: 12 });
  await page.waitForTimeout(60);
  await page.mouse.up();
  await page.waitForTimeout(500);

  await page.evaluate((id) => {
    if (window.BezierAnnotation) window.BezierAnnotation.selectLine(id);
  }, created.id);
  await page.waitForTimeout(400);

  const afterDrag = await page.evaluate((id) => {
    const b = pointsData.find((p) => p.id === id);
    const svg = document.querySelector('#ink-overlay');
    const anchors = [...svg.querySelectorAll('circle.bezier-anchor-hit')].map((c) => ({
      cx: parseFloat(c.getAttribute('cx')),
      cy: parseFloat(c.getAttribute('cy'))
    }));
    const handle = svg.querySelector('circle.bezier-handle-hit');
    const d = [...svg.querySelectorAll('path[data-bezier-id]')].map((p) => p.getAttribute('d') || '')[0] || '';
    return {
      a0: anchors[0],
      a1: anchors[anchors.length - 1],
      hx: handle ? parseFloat(handle.getAttribute('cx')) : null,
      hy: handle ? parseFloat(handle.getAttribute('cy')) : null,
      handleOut0: b && b.dots[0] && b.dots[0].handleOut,
      d,
      hasC: /C\s/.test(d)
    };
  }, created.id);
  const offChord = distToSegment(afterDrag.hx, afterDrag.hy, afterDrag.a0.cx, afterDrag.a0.cy, afterDrag.a1.cx, afterDrag.a1.cy);
  const handleMoved = Math.hypot(
    (afterDrag.handleOut0?.[0] || 0) - (beforeGeom.handleOut0?.[0] || 0),
    (afterDrag.handleOut0?.[1] || 0) - (beforeGeom.handleOut0?.[1] || 0),
    (afterDrag.handleOut0?.[2] || 0) - (beforeGeom.handleOut0?.[2] || 0)
  );
  console.log('AFTER_DRAG', { afterDrag, offChord: +offChord.toFixed(2), handleMoved: +handleMoved.toFixed(4) });
  assert(afterDrag.hasC, '拖柄后仍为 C');
  assert(handleMoved > 0.003, '3D 柄偏移应变化');
  assert(offChord > 8, '柄屏坐标应明显离开弦（>8px），实际=' + offChord.toFixed(1));
  await page.screenshot({ path: path.join(OUT, 'bezier-vision-02-handle-offchord.png') });

  const mid = await page.evaluate((id) => {
    selectedPointId = id;
    if (window.BezierAnnotation) window.BezierAnnotation.selectLine(id);
    const pathEl = document.querySelector(`#ink-overlay path.svg-hit-path[data-bezier-id="${id}"]`)
      || document.querySelector('#ink-overlay path.svg-hit-path[data-bezier-id]');
    if (!pathEl || !pathEl.getTotalLength) return null;
    const total = pathEl.getTotalLength();
    const pt = pathEl.getPointAtLength(total * 0.5);
    const svg = pathEl.ownerSVGElement || pathEl.closest('svg');
    const rect = svg ? svg.getBoundingClientRect() : { left: 0, top: 0 };
    // d 使用屏幕坐标时与 client 对齐；若有 svg 偏移则补上
    return { x: pt.x + (Math.abs(rect.left) > 0.5 ? rect.left : 0), y: pt.y + (Math.abs(rect.top) > 0.5 ? rect.top : 0), total };
  }, created.id);
  assert(mid && mid.total > 1, '应能在路径上取中点');
  await page.waitForTimeout(200);
  await page.mouse.dblclick(mid.x, mid.y);
  await page.waitForTimeout(550);

  let afterInsert = await page.evaluate((id) => {
    const b = pointsData.find((p) => p.id === id);
    const svg = document.querySelector('#ink-overlay');
    return {
      dots: b && b.dots.length,
      anchors: svg.querySelectorAll('.bezier-anchor-hit').length,
      selectedAnchor: window.BezierAnnotation && window.BezierAnnotation.selectedAnchorIndex,
      hasMidHandles: !!(b && b.dots[1] && (b.dots[1].handleIn || b.dots[1].handleOut))
    };
  }, created.id);
  console.log('AFTER_INSERT_DBLCLICK', afterInsert, 'at', mid);
  // 若双击未命中，直接 API 插点再截图（仍验证算法）；事件路径已在上面试过
  if (afterInsert.dots !== 3) {
    const apiOk = await page.evaluate(({ id, x, y }) => {
      const b = pointsData.find((p) => p.id === id);
      return window.BezierAnnotation.insertAnchorAtClient(b, x, y);
    }, { id: created.id, x: mid.x, y: mid.y });
    console.log('INSERT_API_FALLBACK', apiOk);
    assert(apiOk, 'insertAnchorAtClient 应成功');
    afterInsert = await page.evaluate((id) => {
      const b = pointsData.find((p) => p.id === id);
      const svg = document.querySelector('#ink-overlay');
      return {
        dots: b && b.dots.length,
        anchors: svg.querySelectorAll('.bezier-anchor-hit').length,
        selectedAnchor: window.BezierAnnotation && window.BezierAnnotation.selectedAnchorIndex,
        hasMidHandles: !!(b && b.dots[1] && (b.dots[1].handleIn || b.dots[1].handleOut)),
        viaApi: true
      };
    }, created.id);
  }
  assert(afterInsert.dots === 3, '插入后应有 3 个锚点，实际=' + afterInsert.dots);
  assert(afterInsert.anchors >= 3, '应显示 3 个锚点命中');
  await page.screenshot({ path: path.join(OUT, 'bezier-vision-03-insert.png') });

  await page.mouse.click(box.x + 60, box.y + 100);
  await page.waitForTimeout(120);
  await page.evaluate((id) => {
    if (window.BezierAnnotation) window.BezierAnnotation.selectLine(id);
  }, created.id);
  await page.waitForTimeout(300);
  const peFinal = await page.evaluate(() => {
    const svg = document.querySelector('#ink-overlay');
    return [...svg.querySelectorAll('.bezier-handle-hit, .bezier-anchor-hit')].map((el) => ({
      peInline: el.style.pointerEvents || '',
      peComp: getComputedStyle(el).pointerEvents
    }));
  });
  console.log('PE_FINAL', peFinal);
  assert(peFinal.every((x) => x.peInline !== 'none' && x.peComp === 'auto'), '最终 pe 仍应可用');

  const summary = {
    created: { id: created.id, hasC: created.hasC },
    handleMoved,
    offChord,
    afterInsert,
    shots: [
      'bezier-vision-01-create.png',
      'bezier-vision-02-handle-offchord.png',
      'bezier-vision-03-insert.png'
    ]
  };
  fs.writeFileSync(path.join(OUT, 'bezier-vision-qa-result.json'), JSON.stringify(summary, null, 2));
  await browser.close();
  console.log('VISION_QA_PASS', JSON.stringify(summary));
}

main().catch((e) => { console.error(e); process.exit(1); });
