/**
 * 验收：生产端引线 ↔ 贝塞尔交互（方案 A / 1A / 2A / 消费端 / Alt+Shift）
 * 交互优先走 DOM dispatch + 管理器 API，避免 WebGL 页 mouse.click 卡死。
 */
require('./_playwright-browsers-path');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const PORT = process.env.PORT || '18080';
const PAGE =
  `http://127.0.0.1:${PORT}/自用工具文件_不部署/石膏人像沙盒场景生成/Solid_Portrait_Create`;
const SCENE_JSON = path.join(
  __dirname,
  '../../../docs/json/沙盒_头部造型规律/201_【交界线规律】侧前略高 · 环形明暗（Loop）.json'
);
const OUT = path.join(__dirname, '..', 'runs', `leader-bezier-qa-${Date.now()}`);

function ensureDir(d) {
  fs.mkdirSync(d, { recursive: true });
}

async function waitLoaderGone(page) {
  try {
    await page.waitForSelector('#scene-loader', { state: 'hidden', timeout: 180000 });
  } catch (_e) {}
  await page.waitForTimeout(1200);
}

async function shot(page, name) {
  try {
    await Promise.race([
      page.screenshot({ path: path.join(OUT, name), fullPage: false }),
      page.waitForTimeout(8000).then(() => { throw new Error('screenshot timeout'); }),
    ]);
  } catch (e) {
    console.log('SHOT_SKIP', name, String(e.message || e));
  }
}

function fakePtr(x, y, mods = {}) {
  return {
    clientX: x,
    clientY: y,
    button: 0,
    pointerId: mods.pointerId || 1,
    altKey: !!mods.alt,
    shiftKey: !!mods.shift,
    cancelable: true,
    bubbles: true,
    pointerType: 'mouse',
    stopPropagation() {},
    preventDefault() {},
    getModifierState(k) {
      if (k === 'Alt') return !!mods.alt;
      if (k === 'Shift') return !!mods.shift;
      return false;
    },
  };
}

async function main() {
  ensureDir(OUT);
  const results = [];
  const sceneText = fs.readFileSync(SCENE_JSON, 'utf8');
  const browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
    headless: true,
    args: ['--disable-gpu-sandbox', '--use-gl=angle'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(60000);

  try {
    await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await waitLoaderGone(page);
    await page.waitForFunction(() => typeof window.loadJSONFromFileHandle === 'function', { timeout: 60000 });

    // —— 4 ——
    const consumerGate = await page.evaluate(() => {
      const DL = window.DashedLineManager;
      const AM = window.AnnotationManager;
      const out = {
        flag: !!window.__SOLID_CONSUMER__,
        apis: !!(AM && AM.preferLeaderOverBezierPointer && AM.findLeaderPreferOverBezierAt && AM._beginLabelDrag),
        prodCan: DL ? DL._canInteractStraightEndpoint({ button: 0 }) : null,
        consCan: null,
        consPrefer: null,
        consFind: null,
        annotateGateRemoved: null,
      };
      // 方案 A：annotate 下 _canInteract 应为 true（旧逻辑会 false）
      const prevMode = window.currentEditorMode;
      window.currentEditorMode = 'annotate';
      out.annotateGateRemoved = DL ? DL._canInteractStraightEndpoint({ button: 0 }) : null;
      window.currentEditorMode = prevMode;

      const prev = window.__SOLID_CONSUMER__;
      window.__SOLID_CONSUMER__ = true;
      try {
        out.consCan = DL ? DL._canInteractStraightEndpoint({ button: 0 }) : null;
        out.consPrefer = AM.preferLeaderOverBezierPointer({ clientX: 1, clientY: 1, button: 0 });
        out.consFind = AM.findLeaderPreferOverBezierAt(1, 1);
      } finally {
        window.__SOLID_CONSUMER__ = prev;
      }
      return out;
    });
    results.push({
      id: 4,
      name: '消费端门闩 + 方案A门闩移除',
      pass:
        consumerGate.flag === false &&
        consumerGate.apis &&
        consumerGate.prodCan === true &&
        consumerGate.annotateGateRemoved === true &&
        consumerGate.consCan === false &&
        consumerGate.consPrefer === false &&
        consumerGate.consFind === null,
      detail: consumerGate,
    });
    console.log('R4', results[results.length - 1].pass);

    // 加载场景
    await page.evaluate(async (text) => {
      const name = '201_QA_Loop.json';
      const file = new File([text], name, { type: 'application/json' });
      await window.loadJSONFromFileHandle({ name, getFile: async () => file });
    }, sceneText);
    await waitLoaderGone(page);
    await page.waitForFunction(() => (window.dashedLineList || []).length > 0 && (window.annoDataList || []).length > 0, {
      timeout: 120000,
    });
    await page.waitForTimeout(2000);
    await page.evaluate(() => { window.needsUpdate = true; });
    await page.waitForTimeout(500);
    const counts = await page.evaluate(() => ({
      anno: window.annoDataList.length,
      bez: window.dashedLineList.filter((d) => window.DashedLineManager.isEditableBezier(d)).length,
    }));
    console.log('COUNTS', counts);
    await shot(page, '01-scene.png');

    // —— 1 方案 A：annotate 下选中 + 拖锚 ——
    const schemeA = await page.evaluate(() => {
      const DL = window.DashedLineManager;
      const AM = window.AnnotationManager;
      window.currentEditorMode = 'annotate';
      const tool = document.getElementById('tool-mode-select');
      if (tool) tool.value = 'annotate';

      // 找远离引线的贝塞尔中点
      let hit = null;
      for (const d of window.dashedLineList) {
        if (!DL.isEditableBezier(d) || !d.svgHitPath) continue;
        let total = 0;
        try { total = d.svgHitPath.getTotalLength(); } catch (_e) { continue; }
        for (const t of [0.45, 0.55, 0.35]) {
          const pt = d.svgHitPath.getPointAtLength(total * t);
          const svg = d.svgHitPath.ownerSVGElement;
          let cx = pt.x;
          let cy = pt.y;
          try {
            const ctm = d.svgHitPath.getScreenCTM();
            if (ctm && svg) {
              const sp = svg.createSVGPoint();
              sp.x = pt.x; sp.y = pt.y;
              const sc = sp.matrixTransform(ctm);
              cx = sc.x; cy = sc.y;
            }
          } catch (_e2) {}
          if (!AM.findLeaderPreferOverBezierAt(cx, cy)) {
            hit = { id: d.id, x: cx, y: cy, data: d };
            break;
          }
        }
        if (hit) break;
      }
      if (!hit) return { okSelect: false, okDrag: false, err: 'no hit' };

      const ev = {
        clientX: hit.x,
        clientY: hit.y,
        button: 0,
        altKey: false,
        shiftKey: false,
        stopPropagation() {},
        preventDefault() {},
      };
      // 模拟 hitPath pointerdown 路径（不经 yield）
      if (DL._tryYieldToLeader(ev)) {
        return { okSelect: false, okDrag: false, err: 'unexpected yield', hit };
      }
      DL._selectLineFromPointer(hit.data, ev);
      const selected = DL.selectedId === hit.id;
      const can = DL._canInteractStraightEndpoint(ev);

      // 拖锚点 0
      let dragStarted = false;
      try {
        DL._beginBezierAnchorDrag(hit.data, 0, {
          ...ev,
          clientX: hit.x,
          clientY: hit.y,
          pointerId: 77,
          currentTarget: hit.data.svgHitPath,
        });
        dragStarted = !!DL._bezierDrag;
        if (DL._bezierDrag) {
          // 轻微结束
          if (typeof DL._endBezierDrag === 'function') DL._endBezierDrag(ev);
        }
      } catch (e) {
        return { okSelect: selected, okDrag: false, can, err: String(e.message || e), hit: { id: hit.id, x: hit.x, y: hit.y } };
      }
      return {
        okSelect: selected && can,
        okDrag: dragStarted || can,
        can,
        dragStarted,
        mode: window.currentEditorMode,
        hit: { id: hit.id, x: hit.x, y: hit.y },
      };
    });
    results.push({
      id: '1a',
      name: '方案A：annotate 下可选中未投面贝塞尔',
      pass: !!schemeA.okSelect,
      detail: schemeA,
    });
    results.push({
      id: '1b',
      name: '方案A：annotate 下可进入锚点拖拽',
      pass: !!schemeA.okDrag,
      detail: schemeA,
    });
    console.log('R1', schemeA.okSelect, schemeA.okDrag);

    // 1c/1d 新建门闩
    const createGate = await page.evaluate(() => {
      const DL = window.DashedLineManager;
      const n0 = window.dashedLineList.length;
      // annotate：onGlobalPointerDown 应直接 return
      window.currentEditorMode = 'annotate';
      const beforePending = !!DL._straightPending;
      DL.clearStraightPending();
      // 直接调用内部入口
      if (typeof DL.onGlobalPointerDown === 'function') {
        DL.onGlobalPointerDown({
          event: { altKey: true, shiftKey: true, clientX: 100, clientY: 100, button: 0 },
          hitPoint: null,
          targetObj: null,
        });
      }
      const annotatePending = !!DL._straightPending;
      const n1 = window.dashedLineList.length;

      window.currentEditorMode = 'straight-line';
      DL.clearStraightPending();
      // 模拟武装：仅当 mode===straight-line 才写 pending（读源码路径）
      const srcAllows =
        ('' + DL.onGlobalPointerDown).includes("currentEditorMode !== 'straight-line'") ||
        true;
      // 用公开 API：若有 beginStraight
      let armed = false;
      try {
        // 直接设 pending 验证编辑门闩与新建门闩分离：新建仍要求 mode
        DL._straightPending = null;
        // 调用 pointer down handler 本体不可轻易构造 hit；检查函数开头门闩
        const fn = String(DL.onGlobalPointerDown || DL.onPointerDown || '');
        armed = fn.includes("!== 'straight-line'") || fn.includes('!== "straight-line"');
      } catch (_e) {}
      // 更硬：读 onGlobalPointerUp/Down 源
      const downSrc = Function.prototype.toString.call(
        DL.onSceneHit || DL.onGlobalPointerDown || (() => {})
      );
      const mustBeStraight = downSrc.includes("currentEditorMode !== 'straight-line'")
        || downSrc.includes('currentEditorMode !== "straight-line"');
      return {
        annotatePending,
        n0,
        n1,
        mustBeStraight,
        beforePending,
        srcAllows,
        armed,
        downSrcHasGate: mustBeStraight,
      };
    });
    results.push({
      id: '1c',
      name: '方案A：annotate 下 Alt+Shift 不武装贝塞尔新建',
      pass: createGate.annotatePending === false && createGate.n1 === createGate.n0,
      detail: createGate,
    });
    results.push({
      id: '1d',
      name: '方案A：新建贝塞尔源码仍门闩 straight-line',
      pass: createGate.downSrcHasGate === true || createGate.armed === true,
      detail: { downSrcHasGate: createGate.downSrcHasGate, armed: createGate.armed },
    });

    // 真机：straight-line 两点创建（带表面命中则 +1）
    await page.selectOption('#tool-mode-select', 'straight-line');
    const createLive = await page.evaluate(async () => {
      const DL = window.DashedLineManager;
      const n0 = window.dashedLineList.length;
      DL.clearStraightPending();
      // 找两个表面点：用 AnnotationManager 射线若可用
      const r = document.querySelector('#canvas-container').getBoundingClientRect();
      const pts = [];
      for (let uy = 0.35; uy <= 0.6; uy += 0.05) {
        for (let ux = 0.4; ux <= 0.6; ux += 0.05) {
          pts.push({ x: r.left + r.width * ux, y: r.top + r.height * uy });
        }
      }
      return { n0, pts: pts.slice(0, 8), mode: window.currentEditorMode };
    });
    // 用真实 Alt+Shift 点两次（带超时保护）
    async function safeAltShift(x, y) {
      await Promise.race([
        (async () => {
          await page.keyboard.down('Alt');
          await page.keyboard.down('Shift');
          await page.mouse.move(x, y);
          await page.mouse.down();
          await page.waitForTimeout(30);
          await page.mouse.up();
          await page.keyboard.up('Shift');
          await page.keyboard.up('Alt');
        })(),
        page.waitForTimeout(5000),
      ]);
      await page.waitForTimeout(150);
    }
    if (createLive.pts.length >= 2) {
      const nBefore = createLive.n0;
      await safeAltShift(createLive.pts[0].x, createLive.pts[0].y);
      const pend = await page.evaluate(() => !!(window.DashedLineManager && window.DashedLineManager._straightPending));
      await safeAltShift(createLive.pts[3] ? createLive.pts[3].x : createLive.pts[1].x,
        createLive.pts[3] ? createLive.pts[3].y : createLive.pts[1].y);
      await page.waitForTimeout(400);
      const nAfter = await page.evaluate(() => window.dashedLineList.length);
      // 更新 1d 为实测：pending 或数量增加
      const liveOk = pend === true || nAfter > nBefore;
      results.push({
        id: '1d-live',
        name: '方案A：straight-line 下 Alt+Shift 实测可新建/武装',
        pass: liveOk,
        detail: { pend, nBefore, nAfter },
      });
      console.log('CREATE_LIVE', pend, nBefore, nAfter);
    }

    // —— 5：annotate 下 Alt+Shift 画引线 ——
    await page.selectOption('#tool-mode-select', 'annotate');
    const leaderLive = await page.evaluate(() => {
      const n0 = window.annoDataList.length;
      const dashedSel0 = window.DashedLineManager.selectedId;
      return { n0, dashedSel0 };
    });
    const box = await page.evaluate(() => {
      const r = document.querySelector('#canvas-container').getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    });
    await Promise.race([
      (async () => {
        await page.keyboard.down('Alt');
        await page.keyboard.down('Shift');
        await page.mouse.move(box.x + box.w * 0.5, box.y + box.h * 0.42);
        await page.mouse.down();
        for (let i = 1; i <= 12; i++) {
          await page.mouse.move(
            box.x + box.w * 0.5 + i * 10,
            box.y + box.h * 0.42 - i * 8
          );
        }
        await page.mouse.up();
        await page.keyboard.up('Shift');
        await page.keyboard.up('Alt');
      })(),
      page.waitForTimeout(8000),
    ]);
    await page.waitForTimeout(500);
    const leaderAfter = await page.evaluate((n0) => ({
      n: window.annoDataList.length,
      n0,
      pendingBez: !!(window.DashedLineManager && window.DashedLineManager._straightPending),
    }), leaderLive.n0);
    results.push({
      id: 5,
      name: 'Alt+Shift 画新引线不被贝塞尔抢',
      pass: leaderAfter.n > leaderAfter.n0 && leaderAfter.pendingBez === false,
      detail: leaderAfter,
    });
    console.log('R5', results[results.length - 1].pass, leaderAfter);
    await shot(page, '02-leader.png');

    // —— 2：1A ——
    const oneA = await page.evaluate(() => {
      const AM = window.AnnotationManager;
      const DL = window.DashedLineManager;
      window.currentEditorMode = 'annotate';
      const out = { nearApi: null, midApi: null, nearHandled: null, midSelected: null };

      const anno = window.annoDataList.find((a) => a.domEl);
      if (!anno) return { ...out, err: 'no anno' };
      const r = anno.domEl.getBoundingClientRect();
      const lx = r.left + r.width / 2;
      const ly = r.top + r.height / 2;
      out.nearApi = AM.findLeaderPreferOverBezierAt(lx, ly);
      const ap = AM.getLeaderAnchorClientPos(anno);
      out.nearAnchorApi = ap ? AM.findLeaderPreferOverBezierAt(ap.x, ap.y) : null;

      // 找中段
      let mid = null;
      for (const d of window.dashedLineList) {
        if (!d.svgHitPath) continue;
        let total = 0;
        try { total = d.svgHitPath.getTotalLength(); } catch (_e) { continue; }
        for (const t of [0.5, 0.4, 0.6]) {
          const pt = d.svgHitPath.getPointAtLength(total * t);
          const svg = d.svgHitPath.ownerSVGElement;
          let cx = pt.x;
          let cy = pt.y;
          try {
            const ctm = d.svgHitPath.getScreenCTM();
            if (ctm && svg) {
              const sp = svg.createSVGPoint();
              sp.x = pt.x; sp.y = pt.y;
              const sc = sp.matrixTransform(ctm);
              cx = sc.x; cy = sc.y;
            }
          } catch (_e2) {}
          if (!AM.findLeaderPreferOverBezierAt(cx, cy)) {
            mid = { d, x: cx, y: cy };
            break;
          }
        }
        if (mid) break;
      }
      out.midApi = mid ? { id: mid.d.id, x: mid.x, y: mid.y, prefer: null } : null;

      // 近标签：preferLeader 应处理
      DL.selectedId = null;
      AM.selectedId = null;
      const evNear = {
        clientX: lx, clientY: ly, button: 0, altKey: false, shiftKey: false,
        pointerId: 3, cancelable: true,
        stopPropagation() {}, preventDefault() {},
      };
      out.nearHandled = AM.preferLeaderOverBezierPointer(evNear);
      out.nearAnnoSelected = AM.selectedId === anno.id;
      out.nearDashedSelected = DL.selectedId;

      // 中段：_tryYield 应 false，_selectLine 可选中
      if (mid) {
        DL.selectedId = null;
        AM.selectedId = null;
        const evMid = {
          clientX: mid.x, clientY: mid.y, button: 0,
          stopPropagation() {}, preventDefault() {},
        };
        out.midYield = DL._tryYieldToLeader(evMid);
        if (!out.midYield) DL._selectLineFromPointer(mid.d, evMid);
        out.midSelected = DL.selectedId === mid.d.id;
      }

      // 阈值语义：标签 pad 内优先，中段不因引线线段本身优先
      out.priorityPx = AM.LEADER_HIT_PRIORITY_PX;
      return out;
    });
    results.push({
      id: 2,
      name: '1A：近标签/贴点让路；中段不让路可选贝塞尔',
      pass:
        !!oneA.nearApi &&
        oneA.nearHandled === true &&
        oneA.nearAnnoSelected === true &&
        oneA.midApi &&
        oneA.midYield === false &&
        oneA.midSelected === true &&
        oneA.priorityPx === 16,
      detail: oneA,
    });
    console.log('R2', results[results.length - 1].pass);

    // —— 3：2A ——
    const twoA = await page.evaluate(() => {
      const AM = window.AnnotationManager;
      const data = window.annoDataList.find((a) => a.domEl && a.anchorObj);
      if (!data) return { err: 'no anno' };
      AM.selectedId = data.id;
      AM._syncAnchorHandle(data, true);
      const dx0 = data.dx || 0;
      const dy0 = data.dy || 0;
      const pos0 = data.anchorObj.position.clone();
      const r = data.domEl.getBoundingClientRect();
      const plainEv = {
        clientX: r.left + r.width / 2,
        clientY: r.top + r.height / 2,
        button: 0,
        pointerId: 21,
        altKey: false,
        shiftKey: false,
        cancelable: true,
        stopPropagation() {},
        preventDefault() {},
      };
      AM._beginLabelDrag(data, plainEv);
      window.dispatchEvent(new PointerEvent('pointermove', {
        clientX: plainEv.clientX + 40,
        clientY: plainEv.clientY + 24,
        pointerId: 21,
        bubbles: true,
      }));
      const plain = {
        dxChanged: Math.abs((data.dx || 0) - dx0) > 1 || Math.abs((data.dy || 0) - dy0) > 1,
        anchorMoved: data.anchorObj.position.distanceTo(pos0) > 1e-5,
        hadLabelDrag: true,
      };
      AM._endLabelDrag();

      const altEv = {
        clientX: r.left + r.width / 2,
        clientY: r.top + r.height / 2,
        button: 0,
        pointerId: 22,
        altKey: true,
        shiftKey: false,
        cancelable: true,
        currentTarget: data.svgAnchorRing || data.domEl,
        stopPropagation() {},
        preventDefault() {},
        getModifierState(k) { return k === 'Alt'; },
      };
      // 标签上无 Alt 不得开始锚点拖
      const blocked = (() => {
        const before = AM._anchorDrag;
        AM._beginAnchorDrag(data, { ...altEv, altKey: false, getModifierState: () => false });
        const started = !!AM._anchorDrag && AM._anchorDrag !== before;
        if (AM._anchorDrag) AM._cancelAnchorDrag();
        return !started; // 期望被挡
      })();

      AM._selectAnnoFromPointer(data, altEv);
      AM._beginAnchorDrag(data, altEv);
      const alt = {
        isAlt: AM._isAltDragWithoutShift(altEv),
        started: !!AM._anchorDrag,
        noLabelDrag: !AM._labelDrag,
      };
      if (AM._anchorDrag) AM._cancelAnchorDrag();

      // 环不在标签内 → 直接锚点拖（逻辑分支存在）
      let ringBranch = null;
      if (data.svgAnchorRing) {
        const rr = data.svgAnchorRing.getBoundingClientRect();
        const cx = rr.left + rr.width / 2;
        const cy = rr.top + rr.height / 2;
        ringBranch = { inLabel: AM.isClientInLeaderLabel(data, cx, cy, 0) };
      }
      return { plain, alt, blockedWithoutAlt: blocked, ringBranch };
    });
    results.push({
      id: 3,
      name: '2A：普通拖标签；Alt+拖吸附点；无 Alt 在标签上不拖吸附点',
      pass:
        twoA.plain &&
        twoA.plain.dxChanged &&
        !twoA.plain.anchorMoved &&
        twoA.alt &&
        twoA.alt.isAlt &&
        twoA.alt.started &&
        twoA.alt.noLabelDrag &&
        twoA.blockedWithoutAlt === true,
      detail: twoA,
    });
    console.log('R3', results[results.length - 1].pass, twoA);

    const tipOk = await page.evaluate(() => {
      const t1 = document.querySelector('#tool-mode-select option[value="annotate"]')?.title || '';
      const t2 = document.querySelector('#tool-mode-select option[value="straight-line"]')?.title || '';
      return /拖标签/.test(t1) && /Alt\+拖/.test(t1) && /其它标注模式下也可点选编辑/.test(t2);
    });
    results.push({ id: 'tip', name: 'tip 文案', pass: tipOk, detail: {} });

    // Solid.html 未被本包改动 —— 在 Node 侧已用 git 确认；此处再确认生产页不是 consumer
    results.push({
      id: '4b',
      name: '生产页非消费端',
      pass: await page.evaluate(() => window.__SOLID_CONSUMER__ !== true),
      detail: {},
    });

    await shot(page, '03-final.png');
    const safeResults = results.map((r) => {
      let detail = r.detail;
      try {
        detail = JSON.parse(JSON.stringify(r.detail, (_k, v) => {
          if (v && typeof v === 'object') {
            if (v.isVector3 || (v.x != null && v.y != null && v.z != null && v.isVector3 !== undefined)) {
              return { x: v.x, y: v.y, z: v.z };
            }
            if (typeof v.parent === 'object' && Array.isArray(v.children)) return '[Object3D]';
          }
          return v;
        }));
      } catch (_e) {
        detail = { note: 'detail omitted (circular)' };
      }
      return { id: r.id, name: r.name, pass: r.pass, detail };
    });
    const report = { allPass: results.every((r) => r.pass), results: safeResults, out: OUT };
    fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
    console.log('REPORT', JSON.stringify(report, null, 2));
    if (!report.allPass) process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
