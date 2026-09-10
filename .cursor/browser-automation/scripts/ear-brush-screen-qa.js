const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const BUILD_NEED = "20260908aa";

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
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -120);
  await page.waitForTimeout(500);

  const beforePath = path.join(outDir, "screen-qa-before.png");
  await canvas.screenshot({ path: beforePath });

  const openBefore = await page.evaluate(() => {
    function openCount(mesh) {
      const idx = mesh.geometry.index;
      if (!idx) return null;
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
      let o = 0;
      for (const n of m.values()) if (n === 1) o++;
      return { open: o, tris: idx.count / 3, verts: mesh.geometry.attributes.position.count };
    }
    return [...window.__boneMorph.getRoot().children].length >= 0
      ? (() => {
          const out = [];
          window.__boneMorph.getRoot().traverse((o) => {
            if (o.isMesh && o.geometry?.index && o.name !== "sculpt_brush_preview") {
              out.push({ name: o.name, ...openCount(o) });
            }
          });
          return out;
        })()
      : [];
  });

  await page.evaluate(() => {
    document.querySelector('[data-morph-tab="anchors"]')?.click();
    window.__boneMorph.setAnchorToolMode("brush");
    window.__boneMorph.setBrushStrength(0.25);
    window.__boneMorph.setBrushSoftness(0.7);
    window.__boneMorph.setBrushSign(1);
  });

  // API 三笔（高 Y 耳轮）+ 真实拖刷
  const stamps = await page.evaluate(() => {
    const out = [];
    for (let i = 0; i < 3; i++) {
      out.push(
        window.__boneMorph.selftestBrushStamp({
          strength: 0.25,
          softness: 0.7,
          sign: 1,
          radius: 0.0192,
        })
      );
    }
    return out;
  });

  const hx = box.x + box.width * 0.55;
  const hy = box.y + box.height * 0.28;
  await page.mouse.move(hx, hy);
  await page.mouse.down();
  for (let i = 0; i < 10; i++) await page.mouse.move(hx + i * 4, hy + i * 5);
  await page.mouse.up();
  await page.mouse.move(box.x + 8, box.y + 8);
  await page.waitForTimeout(150);

  const afterPath = path.join(outDir, "screen-qa-after.png");
  await canvas.screenshot({ path: afterPath });

  const openAfter = await page.evaluate(() => {
    function openCount(mesh) {
      const idx = mesh.geometry.index;
      if (!idx) return null;
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
      let o = 0;
      for (const n of m.values()) if (n === 1) o++;
      return { open: o, tris: idx.count / 3, verts: mesh.geometry.attributes.position.count };
    }
    const out = [];
    window.__boneMorph.getRoot().traverse((o) => {
      if (o.isMesh && o.geometry?.index && o.name !== "sculpt_brush_preview") {
        out.push({ name: o.name, ...openCount(o) });
      }
    });
    return out;
  });

  const normalsOk = await page.evaluate(() => {
    let ok = true;
    window.__boneMorph.getRoot().traverse((o) => {
      if (!o.isMesh || !o.geometry?.attributes?.position) return;
      if (o.name === "sculpt_brush_preview") return;
      if (o.geometry.attributes.normal?.count !== o.geometry.attributes.position.count) ok = false;
    });
    return ok;
  });

  const build = await page.evaluate(() => window.__boneMorph.getBuildId());
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
        const x0 = Math.floor(img.width * 0.42);
        const y0 = Math.floor(img.height * 0.1);
        const w = Math.floor(img.width * 0.4);
        const h = Math.floor(img.height * 0.5);
        const d = ctx.getImageData(x0, y0, w, h).data;
        let whiteN = 0;
        let darkN = 0;
        let hiVar = 0;
        const n = w * h;
        for (let y = 1; y < h - 1; y++) {
          for (let x = 1; x < w - 1; x++) {
            const i = (y * w + x) * 4;
            const l = (d[i] + d[i + 1] + d[i + 2]) / 3;
            if (l > 235) whiteN++;
            if (l < 45) darkN++;
            const l2 = (d[i + 4] + d[i + 5] + d[i + 6]) / 3;
            if (Math.abs(l - l2) > 40) hiVar++;
          }
        }
        return {
          whiteRatio: whiteN / n,
          darkRatio: darkN / n,
          edgeNoise: hiVar / n,
        };
      };
      return { before: region(a), after: region(b) };
    },
    { b64a: pngB.toString("base64"), b64b: pngA.toString("base64") }
  );

  const openDelta = openAfter.reduce((s, m, i) => s + (m.open - (openBefore[i]?.open || 0)), 0);
  const densified = stamps.some((s) => s.densified && s.vertsAfter > s.vertsBefore);
  const whiteSpike = pix.after.whiteRatio - pix.before.whiteRatio;
  const edgeSpike = pix.after.edgeNoise - pix.before.edgeNoise;
  // 纱窗特征：白底漏出 + 高频边缘噪声暴涨；开放边不应大幅增加
  const noScreen =
    whiteSpike < 0.015 && edgeSpike < 0.04 && openDelta < 800 && pix.after.darkRatio < 0.02;

  const ok =
    String(build).includes(BUILD_NEED) &&
    densified &&
    normalsOk &&
    stamps.every((s) => s.degenerateRatio === 0) &&
    noScreen;

  console.log(
    JSON.stringify(
      {
        build,
        stamps: stamps.map((s) => ({
          ok: s.ok,
          dV: s.vertsAfter - s.vertsBefore,
          back: s.backFacingRatio,
          hitY: s.hit?.[1],
        })),
        openBefore,
        openAfter,
        openDelta,
        normalsOk,
        pix,
        whiteSpike,
        edgeSpike,
        noScreen,
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
