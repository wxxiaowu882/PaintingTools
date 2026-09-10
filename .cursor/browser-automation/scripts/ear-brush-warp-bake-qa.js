const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const BUILD_NEED = "20260908ag";

(async () => {
  const outDir = path.join(__dirname, "..", "runs");
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.on("dialog", async (d) => {
    try {
      await d.accept();
    } catch {}
  });

  await page.goto("http://127.0.0.1:8765/?_=" + Date.now(), {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForFunction(
    () => [...document.getElementById("projectSelect").options].some((o) => /耳/.test(o.textContent)),
    null,
    { timeout: 60000 }
  );
  const pid = await page.evaluate(
    () => [...document.getElementById("projectSelect").options].find((o) => /耳/.test(o.textContent)).value
  );
  await page.selectOption("#projectSelect", pid);
  await page.waitForFunction(
    (need) => !!window.__boneMorph?.getRoot?.() && String(window.__boneMorph.getBuildId?.()).includes(need),
    BUILD_NEED,
    { timeout: 120000 }
  );
  await page.waitForTimeout(2500);

  await page.evaluate(() => {
    try {
      window.__boneMorph.clearDefaultLandmarks?.();
    } catch {}
    try {
      window.__boneMorph.resetMorph?.();
    } catch {}
    window.__boneMorph.setAnchorToolMode?.("warp");
  });

  const canvas = page.locator("canvas").first();
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + 120, box.y + 480);
  await page.mouse.down();
  await page.mouse.move(box.x + 340, box.y + 450);
  await page.mouse.up();
  await page.mouse.move(box.x + box.width * 0.48, box.y + box.height * 0.4);
  for (let i = 0; i < 5; i++) await page.mouse.wheel(0, -120);
  await page.waitForTimeout(400);

  const beforePath = path.join(outDir, "brush-warp-before.png");
  await canvas.screenshot({ path: beforePath });

  const meshStats = () =>
    page.evaluate(() => {
      let verts = 0;
      let open = 0;
      let normalsOk = true;
      window.__boneMorph.getRoot().traverse((o) => {
        if (!o.isMesh || !o.geometry?.attributes?.position) return;
        if (o.name === "sculpt_brush_preview" || o.userData?.lmId != null) return;
        const pos = o.geometry.attributes.position;
        verts += pos.count;
        if (o.geometry.attributes.normal?.count !== pos.count) normalsOk = false;
        const idx = o.geometry.index;
        if (!idx) return;
        const m = new Map();
        const key = (a, b) => (a < b ? `${a}_${b}` : `${b}_${a}`);
        for (let t = 0; t < idx.count; t += 3) {
          const a = idx.getX(t);
          const b = idx.getX(t + 1);
          const c = idx.getX(t + 2);
          for (const [u, v] of [
            [a, b],
            [b, c],
            [c, a],
          ]) {
            const k = key(u, v);
            m.set(k, (m.get(k) || 0) + 1);
          }
        }
        for (const n of m.values()) if (n === 1) open++;
      });
      return { verts, open, normalsOk };
    });

  const before = await meshStats();

  await page.evaluate(() => {
    document.querySelector('[data-morph-tab="anchors"]')?.click();
    window.__boneMorph.setAnchorToolMode("brush");
    window.__boneMorph.setBrushStrength(0.35);
    window.__boneMorph.setBrushSoftness(0.88);
    window.__boneMorph.setBrushSign(1);
  });

  const stamps = await page.evaluate(() => {
    const out = [];
    // 固定 NDC，避免鼓包后「最高点」射线落到边缘导致假失败
    const ndc = { x: 0.12, y: 0.22 };
    for (let i = 0; i < 4; i++) {
      out.push(
        window.__boneMorph.selftestBrushStamp({
          strength: 0.4,
          softness: 0.88,
          sign: 1,
          radius: 0.0192,
          ndc,
        })
      );
    }
    try {
      window.__boneMorph.resetMorph?.();
    } catch {}
    out.push(
      window.__boneMorph.selftestBrushStamp({
        strength: 0.4,
        softness: 0.88,
        sign: -1,
        radius: 0.0192,
        ndc,
      })
    );
    return out;
  });

  await page.mouse.move(box.x + 8, box.y + 8);
  await page.waitForTimeout(120);
  const afterPath = path.join(outDir, "brush-warp-after.png");
  await canvas.screenshot({ path: afterPath });
  const after = await meshStats();

  const build = await page.evaluate(() => window.__boneMorph.getBuildId());
  // 再点「笔刷」会退回拧形；先退到拧形再点一次进入，触发 fillMorphPanel
  const tipOk = await page.evaluate(() => {
    window.__boneMorph.setAnchorToolMode?.("warp");
    document.querySelector('[data-morph-tab="anchors"]')?.click();
    document.getElementById("morphModeBrush")?.click();
    const t = document.getElementById("morphPanel")?.innerText || "";
    return /临时控制点|TPS|不加密/.test(t);
  });

  const pngB = fs.readFileSync(beforePath);
  const pngA = fs.readFileSync(afterPath);
  const pix = await page.evaluate(
    async ({ b64a, b64b }) => {
      function load(b64) {
        return new Promise((res, rej) => {
          const img = new Image();
          img.onload = () => res(img);
          img.onerror = rej;
          img.src = "data:image/png;base64," + b64;
        });
      }
      const a = await load(b64a);
      const b = await load(b64b);
      const c = document.createElement("canvas");
      c.width = a.width;
      c.height = a.height;
      const ctx = c.getContext("2d");
      const region = (img) => {
        ctx.drawImage(img, 0, 0);
        const x0 = Math.floor(img.width * 0.4);
        const y0 = Math.floor(img.height * 0.1);
        const w = Math.floor(img.width * 0.4);
        const h = Math.floor(img.height * 0.5);
        const d = ctx.getImageData(x0, y0, w, h).data;
        let whiteN = 0;
        let sum = 0;
        const n = w * h;
        for (let i = 0; i < n; i++) {
          const o = i * 4;
          const l = (d[o] + d[o + 1] + d[o + 2]) / 3;
          sum += l;
          if (l > 235) whiteN++;
        }
        return { whiteRatio: whiteN / n, mean: sum / n };
      };
      return { before: region(a), after: region(b) };
    },
    { b64a: pngB.toString("base64"), b64b: pngA.toString("base64") }
  );

  // 视觉变化：全图 meanAbs 更稳（ROI 可能大半是白底）
  const meanAbs = await page.evaluate(
    async ({ b64a, b64b }) => {
      function load(b64) {
        return new Promise((res, rej) => {
          const img = new Image();
          img.onload = () => res(img);
          img.onerror = rej;
          img.src = "data:image/png;base64," + b64;
        });
      }
      const a = await load(b64a);
      const b = await load(b64b);
      const c = document.createElement("canvas");
      c.width = a.width;
      c.height = a.height;
      const ctx = c.getContext("2d");
      ctx.drawImage(a, 0, 0);
      const da = ctx.getImageData(0, 0, c.width, c.height).data;
      ctx.drawImage(b, 0, 0);
      const db = ctx.getImageData(0, 0, c.width, c.height).data;
      let sum = 0;
      const n = c.width * c.height;
      for (let i = 0; i < n; i++) {
        const o = i * 4;
        const la = (da[o] + da[o + 1] + da[o + 2]) / 3;
        const lb = (db[o] + db[o + 1] + db[o + 2]) / 3;
        sum += Math.abs(la - lb);
      }
      return sum / n;
    },
    { b64a: pngB.toString("base64"), b64b: pngA.toString("base64") }
  );

  const topologyStable = after.verts === before.verts;
  const openSpike = after.open - before.open;
  const stampsOk = stamps.every((s) => s.ok && s.topologyStable && !s.densified);
  const moved = stamps.some((s) => s.moved > 0 && s.maxDisp > 1e-6);
  const whiteSpike = pix.after.whiteRatio - pix.before.whiteRatio;
  const shapeChanged = meanAbs > 0.35 || stamps.some((s) => s.maxDisp > 0.0003);

  const ok =
    String(build).includes(BUILD_NEED) &&
    topologyStable &&
    after.normalsOk &&
    openSpike < 50 &&
    stampsOk &&
    moved &&
    whiteSpike < 0.02 &&
    shapeChanged &&
    tipOk;

  console.log(
    JSON.stringify(
      {
        build,
        before,
        after,
        topologyStable,
        openSpike,
        stamps: stamps.map((s) => ({
          ok: s.ok,
          moved: s.moved,
          maxDisp: s.maxDisp,
          topologyStable: s.topologyStable,
          densified: s.densified,
          hitY: s.hit?.[1],
        })),
        pix,
        whiteSpike,
        meanAbs,
        shapeChanged,
        tipOk,
        ok,
        beforePath,
        afterPath,
      },
      null,
      2
    )
  );

  await browser.close();
  process.exit(ok ? 0 : 2);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
