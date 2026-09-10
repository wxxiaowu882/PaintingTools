const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const BUILD_NEED = "20260908y";

(async () => {
  const outDir = path.join(__dirname, "..", "runs");
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
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
  await page.waitForTimeout(300);

  const build = await page.evaluate(() => window.__boneMorph.getBuildId());
  const canvas = page.locator("canvas").first();
  const box = await canvas.boundingBox();

  // 先旋转到能看到耳廓，再放大（warp 模式，不会误刷）
  await page.mouse.move(box.x + 80, box.y + 500);
  await page.mouse.down();
  await page.mouse.move(box.x + 80 + 320, box.y + 460);
  await page.mouse.up();
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.42);
  for (let i = 0; i < 5; i++) await page.mouse.wheel(0, -120);
  await page.waitForTimeout(500);

  const beforePath = path.join(outDir, "visual-densify-before.png");
  await canvas.screenshot({ path: beforePath });

  const meshStats = async () =>
    page.evaluate(() => {
      let verts = 0;
      let tris = 0;
      let deg = 0;
      let sample = 0;
      window.__boneMorph.getRoot().traverse((o) => {
        if (!o.isMesh || !o.geometry?.attributes?.position) return;
        if (o.name === "sculpt_brush_preview" || o.userData?.lmId != null) return;
        const a = o.geometry.attributes.position;
        const index = o.geometry.index;
        verts += a.count;
        const tc = index ? index.count / 3 : Math.floor(a.count / 3);
        tris += tc;
        const step = Math.max(1, Math.floor(tc / 2500));
        for (let t = 0; t < tc; t += step) {
          const ia = index ? index.getX(t * 3) : t * 3;
          const ib = index ? index.getX(t * 3 + 1) : t * 3 + 1;
          const ic = index ? index.getX(t * 3 + 2) : t * 3 + 2;
          const ax = a.getX(ia),
            ay = a.getY(ia),
            az = a.getZ(ia);
          const bx = a.getX(ib),
            by = a.getY(ib),
            bz = a.getZ(ib);
          const cx = a.getX(ic),
            cy = a.getY(ic),
            cz = a.getZ(ic);
          const nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
          const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
          const nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
          sample++;
          if (Math.hypot(nx, ny, nz) < 1e-14) deg++;
        }
      });
      return { verts, tris, degRatio: deg / Math.max(sample, 1) };
    });

  const before = await meshStats();

  await page.evaluate(() => {
    document.querySelector('[data-morph-tab="anchors"]')?.click();
    window.__boneMorph.setAnchorToolMode("brush");
    window.__boneMorph.setBrushStrength(0.28);
    window.__boneMorph.setBrushSoftness(0.75);
    window.__boneMorph.setBrushSign(1);
  });
  await page.waitForTimeout(200);

  const stamps = await page.evaluate(() => {
    const out = [];
    for (let i = 0; i < 3; i++) {
      out.push(
        window.__boneMorph.selftestBrushStamp({
          strength: 0.28,
          softness: 0.75,
          sign: 1,
          radius: 0.018,
        })
      );
    }
    return out;
  });

  // 移开指针，关掉预览环再截图
  await page.mouse.move(box.x + 12, box.y + 12);
  await page.waitForTimeout(150);
  const afterPath = path.join(outDir, "visual-densify-after.png");
  await canvas.screenshot({ path: afterPath });
  const after = await meshStats();

  const pngAfter = fs.readFileSync(afterPath);
  const pngBefore = fs.readFileSync(beforePath);
  const dark = await page.evaluate(
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
        const x0 = Math.floor(img.width * 0.3);
        const y0 = Math.floor(img.height * 0.15);
        const w = Math.floor(img.width * 0.45);
        const h = Math.floor(img.height * 0.55);
        const d = ctx.getImageData(x0, y0, w, h).data;
        let darkN = 0;
        let midN = 0;
        const n = w * h;
        for (let i = 0; i < n; i++) {
          const o = i * 4;
          const l = (d[o] + d[o + 1] + d[o + 2]) / 3;
          if (l < 35) darkN++;
          if (l > 55 && l < 200) midN++;
        }
        return { darkN, midN, n, darkRatio: darkN / n, midRatio: midN / n };
      };
      return { before: region(a), after: region(b) };
    },
    { b64a: pngBefore.toString("base64"), b64b: pngAfter.toString("base64") }
  );

  const vertGain = after.verts - before.verts;
  const stampsOk = stamps.every((s) => s.ok && s.degenerateRatio === 0);
  const backOk = stamps.every((s) => (s.backFacingRatio ?? 0) < 0.12);
  const densified = stamps.every((s) => s.densified) && vertGain > 400;
  const darkSpike = dark.after.darkRatio - dark.before.darkRatio;
  const cleanStart = before.verts <= 92200;

  const blob = await page.evaluate(async ({ b64 }) => {
    function load(b64s) {
      return new Promise((res, rej) => {
        const img = new Image();
        img.onload = () => res(img);
        img.onerror = rej;
        img.src = "data:image/png;base64," + b64s;
      });
    }
    const img = await load(b64);
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const { data, width: w, height: h } = ctx.getImageData(0, 0, c.width, c.height);
    const mask = new Uint8Array(w * h);
    let vd = 0;
    for (let i = 0; i < w * h; i++) {
      const o = i * 4;
      const l = (data[o] + data[o + 1] + data[o + 2]) / 3;
      if (l < 40) mask[i] = 1;
      if (l < 25) vd++;
    }
    const seen = new Uint8Array(w * h);
    let largest = 0;
    for (let i = 0; i < w * h; i++) {
      if (!mask[i] || seen[i]) continue;
      const q = [i];
      seen[i] = 1;
      let n = 0;
      while (q.length) {
        const p = q.pop();
        n++;
        const x = p % w;
        const y = (p - x) / w;
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = ny * w + nx;
          if (!mask[j] || seen[j]) continue;
          seen[j] = 1;
          q.push(j);
        }
      }
      if (n > largest) largest = n;
    }
    return { veryDarkRatio: vd / (w * h), largestDarkBlob: largest };
  }, { b64: pngAfter.toString("base64") });

  const normalsOk = await page.evaluate(() => {
    let ok = true;
    window.__boneMorph.getRoot().traverse((o) => {
      if (!o.isMesh || !o.geometry?.attributes?.position) return;
      if (o.name === "sculpt_brush_preview" || o.userData?.lmId != null) return;
      const pc = o.geometry.attributes.position.count;
      const nc = o.geometry.attributes.normal?.count ?? -1;
      if (nc !== pc) ok = false;
    });
    return ok;
  });

  const noBlackBlob = darkSpike < 0.04 && blob.largestDarkBlob < 2500 && blob.veryDarkRatio < 0.008;

  const ok =
    String(build).includes(BUILD_NEED) &&
    cleanStart &&
    stampsOk &&
    backOk &&
    densified &&
    after.degRatio < 0.01 &&
    vertGain > 600 &&
    noBlackBlob &&
    normalsOk;

  console.log(
    JSON.stringify(
      {
        build,
        before,
        after,
        vertGain,
        cleanStart,
        stamps: stamps.map((s) => ({
          ok: s.ok,
          densified: s.densified,
          dV: s.vertsAfter - s.vertsBefore,
          deg: s.degenerateRatio,
          back: s.backFacingRatio,
          hitY: s.hit?.[1],
        })),
        dark,
        darkSpike,
        blob,
        normalsOk,
        densified,
        backOk,
        noBlackBlob,
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
