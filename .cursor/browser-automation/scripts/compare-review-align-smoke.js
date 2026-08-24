/**
 * Smoke: PRIMARY views align + front exposure (no blown-out white model).
 * Run: npm run smoke:compare-align
 */
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const RUNS = path.resolve(__dirname, "../runs");
const OUT = path.join(RUNS, `compare_align_primary_${Date.now()}`);
const PRIMARY = ["front", "side", "back"];
const AUX = ["front_three_quarter", "rear_three_quarter"];

async function measureView(page) {
  return page.evaluate(() => {
    const b = document.querySelector("#layerBase img");
    const o = document.querySelector("#layerOurs img");
    if (!b || !o) return { ok: false, reason: "missing img" };
    const bt = parseFloat(b.dataset.headTop || "NaN");
    const bb = parseFloat(b.dataset.headBottom || "NaN");
    const ot = parseFloat(o.dataset.headTop || "NaN");
    const ob = parseFloat(o.dataset.headBottom || "NaN");
    return {
      ok: true,
      deltaTop: Math.abs(bt - ot),
      deltaBottom: Math.abs(bb - ob),
      styled: !!(b.style.height && o.style.height),
    };
  });
}

async function checkExposure(page) {
  return page.evaluate(async () => {
    const ours = document.querySelector("#layerOurs img");
    const base = document.querySelector("#layerBase img");
    if (!ours) return { ok: false, reason: "missing ours img" };

    async function statsFromEl(img) {
      if (!img.complete) await new Promise((r) => (img.onload = r));
      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;
      if (w < 8 || h < 8) return { ok: false, reason: "img too small" };
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const px = ctx.getImageData(0, 0, w, h).data;
      const bg = [px[0], px[1], px[2]];
      const ch = [[], [], []];
      let clip = 0;
      let n = 0;
      for (let i = 0; i < px.length; i += 4) {
        const d = Math.abs(px[i] - bg[0]) + Math.abs(px[i + 1] - bg[1]) + Math.abs(px[i + 2] - bg[2]);
        if (d <= 60) continue;
        n++;
        ch[0].push(px[i]); ch[1].push(px[i + 1]); ch[2].push(px[i + 2]);
        if (px[i] >= 250 && px[i + 1] >= 250 && px[i + 2] >= 250) clip++;
      }
      if (!n) return { ok: false, reason: "no foreground" };
      const mean = ch.map((a) => a.reduce((s, v) => s + v, 0) / n);
      const std = ch.map((a) => {
        const m = a.reduce((s, v) => s + v, 0) / n;
        return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / n);
      });
      return {
        ok: true,
        mean,
        stdMin: Math.min(...std),
        clipFrac: clip / n,
        bg,
        meanMax: Math.max(...mean),
      };
    }

    const so = await statsFromEl(ours);
    if (!so.ok) return so;
    const sb = base ? await statsFromEl(base) : null;
    const bgOk = so.bg.every((v) => v >= 250);
    const flat = so.stdMin < (sb ? sb.stdMin * 0.58 : 18);
    const meanDelta = sb
      ? Math.hypot(so.mean[0] - sb.mean[0], so.mean[1] - sb.mean[1], so.mean[2] - sb.mean[2])
      : 0;
    const colorDrift = sb ? meanDelta > 24 : so.meanMax > 165;
    const pass =
      bgOk &&
      !flat &&
      !colorDrift &&
      so.clipFrac <= 0.01 &&
      so.meanMax <= 220;
    return {
      ok: pass,
      mean: so.mean,
      clipFrac: so.clipFrac,
      bg: so.bg,
      meanMax: so.meanMax,
      stdMin: so.stdMin,
      baseStdMin: sb ? sb.stdMin : null,
      meanDelta,
      flat,
      colorDrift,
    };
  });
}

async function checkView(page, view, gated) {
  await page.click(`[data-view="${view}"]`);
  await page.waitForTimeout(1400);
  const m = await measureView(page);
  const shot = path.join(OUT, `slider_${view}.png`);
  await page.screenshot({ path: shot, fullPage: false });
  const pass = m.ok && m.styled && m.deltaTop <= 2 && m.deltaBottom <= 2;
  const tag = gated ? (pass ? "PASS" : "FAIL") : pass ? "ok" : "warn";
  console.log(
    view,
    gated ? tag : `[aux ${tag}]`,
    m.ok ? `dTop=${m.deltaTop.toFixed(2)} dBot=${m.deltaBottom.toFixed(2)}` : m.reason,
    shot
  );
  return { gated, pass, view };
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await page.goto("http://127.0.0.1:8765/", { waitUntil: "networkidle", timeout: 15000 });
  } catch (e) {
    console.error("[FAIL] start 打开对照页.bat first");
    process.exit(1);
  }
  await page.click('button[data-mode="slider"]');
  const fails = [];

  for (const view of PRIMARY) {
    const r = await checkView(page, view, true);
    if (r.gated && !r.pass) fails.push(r.view);
    if (view === "front") {
      const ex = await checkExposure(page);
      const exPass = ex.ok;
      console.log(
        "front visual",
        exPass ? "PASS" : "FAIL",
        ex.ok === false && ex.reason
          ? ex.reason
          : `meanMax=${(ex.meanMax || 0).toFixed(1)} stdMin=${(ex.stdMin || 0).toFixed(1)}` +
              (ex.baseStdMin != null ? ` baseStd=${ex.baseStdMin.toFixed(1)}` : "") +
              ` meanΔ=${(ex.meanDelta || 0).toFixed(1)} flat=${!!ex.flat} colorDrift=${!!ex.colorDrift}` +
              ` clip=${((ex.clipFrac || 0) * 100).toFixed(1)}% bg=[${(ex.bg || []).join(",")}]`
      );
      if (!exPass) fails.push("front-exposure");
    }
  }
  for (const view of AUX) {
    await checkView(page, view, false);
  }

  await browser.close();
  if (fails.length) {
    console.error("[FAIL]", fails.join(", "));
    process.exit(1);
  }
  console.log("[PASS] primary align + front visual vs Base");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
