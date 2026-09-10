/**
 * 设色 QA → compare_review/qa_reports/latest/index.html
 * 验收策略：截图 + 区域像素对比（模拟肉眼），不再仅靠探针打点
 * Run: node scripts/bone-morph-color-qa-report.js
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { chromium } = require("playwright");

const BASE = process.env.BASE_URL || "http://127.0.0.1:8765";
const REPO_ROOT = path.resolve(__dirname, "../../..");
const REPORT_DIR = path.join(
  REPO_ROOT,
  "自用工具文件_不部署/篡改猴/亚洲头部肌肉模型/work_v4/compare_review/qa_reports/latest"
);

/** 用户截图复现：色相约 -56°、饱和度 35 */
const HSL_USER = { dh: -56 / 360, ds: 0.35, dl: 0 };
const HSL_QA = { dh: 0.12, ds: 0.85, dl: 0.12 };

const VIEWS = [
  {
    id: "user_side_L",
    name: "用户复现·左侧面点耳",
    drag: { x0: 0.55, x1: 0.22, y: 0.4 },
    click: [0.58, 0.46],
    hsl: HSL_USER,
    earCrop: [0.14, 0.16],
    neckOffset: [0.06, 0.22],
    minEarChanged: 350,
    maxNeckChanged: 80,
  },
  {
    id: "side_L",
    name: "左侧面",
    drag: { x0: 0.55, x1: 0.22, y: 0.4 },
    click: [0.59, 0.54],
    hsl: HSL_QA,
    earCrop: [0.14, 0.16],
    neckOffset: [0.08, 0.24],
    minEarChanged: 420,
    maxNeckChanged: 60,
  },
  {
    id: "side_R",
    name: "右侧面",
    drag: { x0: 0.45, x1: 0.78, y: 0.4 },
    click: [0.38, 0.48],
    hsl: HSL_QA,
    earCrop: [0.14, 0.16],
    neckOffset: [-0.08, 0.24],
    minEarChanged: 260,
    maxNeckChanged: 60,
  },
  {
    id: "three_q_L",
    name: "左四分之三",
    drag: { x0: 0.58, x1: 0.3, y: 0.38 },
    click: [0.40, 0.50],
    visualCenter: [0.40, 0.42],
    neckCenter: [0.72, 0.76],
    neckCrop: [0.12, 0.12],
    hsl: HSL_QA,
    earCrop: [0.14, 0.16],
    minEarChanged: 400,
    maxNeckChanged: 80,
  },
];

function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function analyzeCropPair(beforePath, afterPath, diffThresh = 22) {
  const py = `
from PIL import Image
import json
a=Image.open(r'''${beforePath.replace(/\\/g, "/")}''').convert('RGB')
b=Image.open(r'''${afterPath.replace(/\\/g, "/")}''').convert('RGB')
w,h=a.size
changed=0; hueShift=0; samples=[]
for y in range(0,h,2):
  for x in range(0,w,2):
    pa=a.getpixel((x,y)); pb=b.getpixel((x,y))
    d=abs(pa[0]-pb[0])+abs(pa[1]-pb[1])+abs(pa[2]-pb[2])
    if d<${diffThresh}: continue
    changed+=1
    if pb[0]>pa[0]+12 and pb[2]>pa[2]+8: hueShift+=1
    if len(samples)<5: samples.append({'x':round(x/w,3),'y':round(y/h,3),'d':d,'before':pa,'after':pb})
print(json.dumps({'changed':changed,'hueShift':hueShift,'samples':samples}))
`;
  const r = spawnSync("python", ["-c", py], { encoding: "utf8" });
  if (r.status !== 0) return { error: r.stderr || r.stdout || "python failed" };
  try {
    return JSON.parse((r.stdout || "").trim());
  } catch (e) {
    return { error: "parse: " + (r.stdout || "").slice(0, 200) };
  }
}

function regionAround(cx, cy, hw, hh) {
  return {
    x0: Math.max(0.04, cx - hw),
    y0: Math.max(0.04, cy - hh),
    x1: Math.min(0.96, cx + hw),
    y1: Math.min(0.96, cy + hh),
  };
}

function judgeVisual(view, pick, paint, visual) {
  const reasons = [];
  const keys = paint.meshColorKeys || [];
  if (pick.label !== "整耳") reasons.push(`标签=${pick.label || "空"}`);
  if (!String(pick.region || "").includes("ear_geom")) {
    reasons.push(`非几何整耳 region=${pick.region || "空"}（疑似旧版语义单层）`);
  }
  if (!keys.some((k) => /static/i.test(k)) || !keys.some((k) => /deform/i.test(k))) {
    reasons.push("缺 Static/Deform 双层");
  }
  if ((pick.px || 0) < 12000) reasons.push(`选区过小 px=${pick.px}`);
  if ((pick.px || 0) > 42000) reasons.push(`选区过大 px=${pick.px}（可能含脖子）`);
  const s = paint.static;
  const d = paint.deform;
  if (!s || s.inMaskChanged < 3000) reasons.push(`Static 贴图变色不足=${s?.inMaskChanged || 0}`);
  if (!d || d.inMaskChanged < 2000) reasons.push(`Deform 贴图变色不足=${d?.inMaskChanged || 0}`);
  const bleed = (s?.outMaskChanged || 0) + (d?.outMaskChanged || 0);
  if (bleed > 600) reasons.push(`mask 外渗漏=${bleed}`);

  if (visual.ear?.error || visual.neck?.error) {
    reasons.push(`截图分析失败: ${visual.ear?.error || visual.neck?.error}`);
  } else {
    const earN = visual.ear?.changed || 0;
    const neckN = visual.neck?.changed || 0;
    if (earN < view.minEarChanged) {
      reasons.push(`耳部裁剪图变色不足 ${earN}（需≥${view.minEarChanged}）`);
    }
    if (neckN > view.maxNeckChanged) {
      reasons.push(`脖子裁剪图误变色 ${neckN}（需≤${view.maxNeckChanged}）`);
    }
  }

  return {
    ok: !reasons.length,
    reasons,
    visual,
    bleed,
  };
}

async function rotate(page, box, drag) {
  await page.mouse.move(box.x + box.width * drag.x0, box.y + box.height * drag.y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * drag.x1, box.y + box.height * drag.y, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(400);
}

async function shotRegion(page, canvas, region, outPath) {
  const box = await canvas.boundingBox();
  if (!box) return;
  const x = box.x + box.width * region.x0;
  const y = box.y + box.height * region.y0;
  const w = box.width * (region.x1 - region.x0);
  const h = box.height * (region.y1 - region.y0);
  await page.screenshot({
    path: outPath,
    clip: { x, y, width: w, height: h },
  });
}

function writeHtml(report) {
  const rows = report.earCases
    .map((c) => {
      const cls = c.verdict.ok ? "pass" : "fail";
      const rs = c.verdict.reasons.length
        ? `<ul class="fail-list">${c.verdict.reasons.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>`
        : "<p class='ok-line'>✅ 截图可视 + 数据均通过</p>";
      const v = c.verdict.visual || {};
      return `<article class="case ${cls}">
<h3>${esc(c.view)} <span class="badge ${cls}">${c.verdict.ok ? "PASS" : "FAIL"}</span></h3>
<p class="meta">点击 ${esc(c.point)} · ${esc(c.pick.label)} · ${c.pick.px}px · HSL ${esc(c.hslNote)}</p>
<p class="meta">贴图 Static ${c.paint.static?.inMaskChanged}/${c.paint.static?.inMaskTotal} · Deform ${c.paint.deform?.inMaskChanged}/${c.paint.deform?.inMaskTotal}</p>
<p class="meta visual">截图分析：耳区变色像素 <strong>${v.ear?.changed ?? "—"}</strong> · 脖子区 <strong>${v.neck?.changed ?? "—"}</strong></p>
${rs}
<div class="shots">
<figure><img src="${c.imgEarBefore}" alt="耳区前"/><figcaption>耳区·设色前</figcaption></figure>
<figure><img src="${c.imgEarAfter}" alt="耳区后"/><figcaption>耳区·设色后（应整耳变色）</figcaption></figure>
<figure><img src="${c.imgNeckBefore}" alt="脖子前"/><figcaption>脖子区·设色前</figcaption></figure>
<figure><img src="${c.imgNeckAfter}" alt="脖子后"/><figcaption>脖子区·设色后（应不变色）</figcaption></figure>
<figure><img src="${c.imgFullAfter}" alt="全图后"/><figcaption>全画布·设色后</figcaption></figure>
</div></article>`;
    })
    .join("\n");
  const g = report.galea;
  fs.writeFileSync(
    path.join(REPORT_DIR, "index.html"),
    `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"/>
<title>设色 QA ${esc(report.stamp)}</title>
<style>
body{font-family:"Microsoft YaHei",sans-serif;background:#111;color:#eee;padding:20px;max-width:1400px;margin:0 auto}
h1{margin:0 0 8px} h2{margin-top:28px;border-bottom:1px solid #333;padding-bottom:6px}
.summary{padding:14px 16px;border-radius:8px;margin:16px 0;font-size:1.05rem}
.summary.pass{background:#1a3d32;border:1px solid #3a8}
.summary.fail{background:#3d1a1a;border:1px solid #a44}
.case{border:1px solid #444;border-radius:8px;padding:14px;margin:14px 0}
.case.pass{border-color:#3a8}.case.fail{border-color:#a44}
.badge{font-size:.72rem;padding:2px 8px;border-radius:4px;margin-left:8px}
.badge.pass{background:#2a8;color:#fff}.badge.fail{background:#c44;color:#fff}
.meta{color:#bbb;margin:4px 0;font-size:.9rem}.meta.visual{color:#9cf}
.ok-line{color:#6d9}.fail-list{color:#faa;margin:8px 0 8px 18px}
.shots{display:flex;flex-wrap:wrap;gap:12px;margin-top:12px}
.shots figure{margin:0;text-align:center}
.shots img{max-width:300px;border:2px solid #555;border-radius:4px;background:#fff}
.shots figcaption{font-size:.75rem;color:#999;margin-top:4px}
.note{background:#222;border-left:3px solid #6af;padding:10px 12px;margin:12px 0;font-size:.88rem;color:#ccc}
</style></head><body>
<h1>设色 QA（截图肉眼验收）</h1>
<p>${esc(report.stamp)}</p>
<div class="summary ${report.ok ? "pass" : "fail"}">${report.ok ? "✅ 全部通过" : "❌ 失败 — 请对比耳区/脖子区截图"}</div>
<div class="note">判定：① 整耳双层 ② 耳区裁剪图前后对比应有大量变色像素 ③ <strong>脖子区裁剪图应几乎不变</strong>（像素差&gt;28 的计数≤阈值）。不再用「探针凑数」代替整耳目视。</div>
<p>耳朵 ${report.earPass}/${report.earCases.length} · 帽状腱膜 ${g.ok ? "通过" : "失败"}</p>
<h2>耳朵整耳设色</h2>${rows}
<h2>帽状腱膜</h2>
<article class="case ${g.ok ? "pass" : "fail"}"><h3>${esc(g.name)}</h3>
<p>${g.ok ? "✅" : "❌"} ${esc(g.reasons?.join("; ") || "OK")}</p></article>
</body></html>`,
    "utf8"
  );
  fs.writeFileSync(path.join(REPORT_DIR, "report.json"), JSON.stringify(report, null, 2));
}

(async () => {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace("T", " ").slice(0, 19);
  const browser = await chromium.launch({
    headless: true,
    args: ["--use-gl=angle", "--ignore-gpu-blocklist"],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 960 } });
  const canvas = page.locator("#viewerHost canvas");
  const earCases = [];

  async function loadReady() {
    await page.goto(`${BASE}/?_=${Date.now()}`, { waitUntil: "load", timeout: 120000 });
    await page.waitForFunction(
      () =>
        !!window.__boneMorph &&
        (document.getElementById("viewerStatus")?.textContent || "").includes("拧形"),
      { timeout: 180000 }
    );
    await page.waitForTimeout(500);
  }

  for (const view of VIEWS) {
    await loadReady();
    const box = await canvas.boundingBox();
    await rotate(page, box, view.drag);
    await page.waitForTimeout(1000);

    const id = view.id;
    const [cx, cy] = view.click;
    const [vx, vy] = view.visualCenter || view.click;
    const hsl = view.hsl || HSL_QA;
    const [ew, eh] = view.earCrop || [0.14, 0.16];
    const [nox, noy] = view.neckOffset || [0.06, 0.22];
    const [nw, nh] = view.neckCrop || [ew * 0.9, eh * 0.85];
    const earRegion = regionAround(vx, vy, ew, eh);
    const [nx, ny] = view.neckCenter || [vx + nox, vy + noy];
    const neckRegion = regionAround(nx, ny, nw, nh);

    await page.evaluate(() => window.__boneMorph.debugClearMeshColors());
    await page.waitForTimeout(200);
    const beforeFull = path.join(REPORT_DIR, `${id}_full_before.png`);
    const afterFull = path.join(REPORT_DIR, `${id}_full_after.png`);
    const earBefore = path.join(REPORT_DIR, `${id}_ear_before.png`);
    const earAfter = path.join(REPORT_DIR, `${id}_ear_after.png`);
    const neckBefore = path.join(REPORT_DIR, `${id}_neck_before.png`);
    const neckAfter = path.join(REPORT_DIR, `${id}_neck_after.png`);

    await canvas.screenshot({ path: beforeFull });
    await shotRegion(page, canvas, earRegion, earBefore);
    await shotRegion(page, canvas, neckRegion, neckBefore);

    let pickSt = { label: "", px: 0, region: null, meshColors: [] };
    for (let attempt = 0; attempt < 5; attempt++) {
      await page.evaluate(() => window.__boneMorph.debugClearMeshColors());
      await page.waitForTimeout(100);
      const ok = await page.evaluate(
        ({ nx, ny }) => window.__boneMorph.debugSelectAtCanvas01(nx, ny),
        { nx: cx, ny: cy }
      );
      pickSt = await page.evaluate(() => {
        const st = window.__boneMorph.getState();
        return {
          label: st.selectedPartLabel,
          px: st.selectedRegionPixels,
          region: st.selectedRegionKey,
          meshColors: Object.keys(st.meshColors || {}),
          buildId: st.buildId,
        };
      });
      if (ok && pickSt.label === "整耳" && pickSt.px >= 12000 && String(pickSt.region || "").includes("ear_geom")) break;
      await page.waitForTimeout(300);
    }

    await page.evaluate(
      (h) => window.__boneMorph.setScopeHsl(h.dh, h.ds, h.dl, { notify: true, immediate: true }),
      hsl
    );
    await page.waitForTimeout(700);

    const paint = await page.evaluate(() => window.__boneMorph.debugAtlasPaintStats());
    await canvas.screenshot({ path: afterFull });
    await shotRegion(page, canvas, earRegion, earAfter);
    await shotRegion(page, canvas, neckRegion, neckAfter);

    const earVisual = analyzeCropPair(earBefore, earAfter, view.hsl === HSL_USER ? 18 : 22);
    const neckVisual = analyzeCropPair(neckBefore, neckAfter, view.hsl === HSL_USER ? 18 : 22);
    const visual = { ear: earVisual, neck: neckVisual };
    const verdict = judgeVisual(view, pickSt, paint, visual);
    earCases.push({
      id,
      view: view.name,
      point: `(${(cx * 100).toFixed(0)}%, ${(cy * 100).toFixed(0)}%)`,
      hslNote: `H=${Math.round((hsl.dh || 0) * 360)}° S=${Math.round((hsl.ds || 0) * 100)}`,
      pick: pickSt,
      paint,
      verdict,
      imgEarBefore: `${id}_ear_before.png`,
      imgEarAfter: `${id}_ear_after.png`,
      imgNeckBefore: `${id}_neck_before.png`,
      imgNeckAfter: `${id}_neck_after.png`,
      imgFullAfter: `${id}_full_after.png`,
    });
    console.log(
      verdict.ok ? "  ✓" : "  ✗",
      view.id,
      `耳${visual.ear?.changed ?? "?"} 脖${visual.neck?.changed ?? "?"}`,
      verdict.reasons.join("; ") || "OK"
    );
  }

  await loadReady();
  let galea = { name: "帽状腱膜", ok: false, reasons: ["未测"] };
  const galeaPt = await page.evaluate(() => {
    let best = null;
    for (let ny = 0.08; ny <= 0.22; ny += 0.03) {
      for (let nx = 0.38; nx <= 0.62; nx += 0.03) {
        const p = window.__boneMorph.debugSamplePickAtNdc(nx, ny, "Deform");
        if (!p?.pick || p.pick.px < 8000) continue;
        const h = p.pick.hex || "";
        const R = parseInt(h.slice(1, 3), 16);
        const B = parseInt(h.slice(5, 7), 16);
        if (B >= R - 8 && (!best || p.pick.px > best.px)) best = { nx, ny, px: p.pick.px };
      }
    }
    return best;
  });
  if (galeaPt) {
    await page.evaluate(() => window.__boneMorph.debugClearMeshColors());
    await page.evaluate(({ nx, ny }) => window.__boneMorph.debugSelectAtCanvas01(nx, ny), galeaPt);
    const pickSt = await page.evaluate(() => {
      const st = window.__boneMorph.getState();
      return { label: st.selectedPartLabel, px: st.selectedRegionPixels };
    });
    await page.evaluate(
      (h) => window.__boneMorph.setScopeHsl(h.dh, h.ds, h.dl, { notify: true, immediate: true }),
      HSL_QA
    );
    const paint = await page.evaluate(() => window.__boneMorph.debugAtlasPaintStats());
    const reasons = [];
    if (pickSt.label === "整耳") reasons.push("误选整耳");
    if ((pickSt.px || 0) < 8000) reasons.push(`px=${pickSt.px}`);
    if ((paint.deform?.inMaskChanged || 0) < 8000) reasons.push("Deform 变色不足");
    galea = { name: "帽状腱膜", ok: !reasons.length, reasons };
  }
  console.log(galea.ok ? "✓ 帽状腱膜" : "✗ 帽状腱膜", galea.reasons?.join("; ") || "");

  await browser.close();
  const earPass = earCases.filter((c) => c.verdict.ok).length;
  const ok = earCases.length > 0 && earCases.every((c) => c.verdict.ok) && galea.ok;
  const report = { stamp, ok, earPass, earCases, galea };
  writeHtml(report);
  const url = `${BASE}/qa_reports/latest/index.html`;
  console.log("\n" + (ok ? "OK" : "FAIL"), url);
  process.exit(ok ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
