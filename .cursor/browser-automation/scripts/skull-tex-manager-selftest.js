/**
 * 在 GLB 管理器中加载修好的头骨，确认有 NORMAL 且表面不呈平直三角面。
 * 需仓库根 HTTP：python -m http.server 8767
 */
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "../../..");
const RUNS = path.join(__dirname, "../runs");
const MANAGER =
  "http://127.0.0.1:8767/" +
  encodeURI("自用工具文件_不部署/GBL管理器/Glb管理器.html");
const OURS = path.join(
  ROOT,
  "自用工具文件_不部署/头骨分色骨缝/out/human02_parts_color_tex.glb"
);
const ORIG = path.join(
  ROOT,
  "自用工具文件_不部署/头骨分色骨缝/input/human02_raw.glb"
);

async function loadGlb(page, filePath, name) {
  const buf = fs.readFileSync(filePath);
  const b64 = buf.toString("base64");
  await page.evaluate(
    async ({ b64, name }) => {
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      await window.__AGENT_LOAD_GLB_BUFFER__(bin.buffer, name);
    },
    { b64, name }
  );
  await page.waitForTimeout(1500);
}

async function probe(page) {
  return page.evaluate(() => {
    const sc = window.__AGENT_PROCESSING_SCENE__;
    if (!sc || !sc.scene) return { err: "no scene" };
    let meshes = 0;
    let withNorm = 0;
    let flatMats = 0;
    let matTypes = {};
    let mapsNoMip = 0;
    let mapsTotal = 0;
    let mapW = 0;
    let mapH = 0;
    sc.scene.traverse((n) => {
      if (!n.isMesh || !n.geometry) return;
      meshes++;
      if (n.geometry.getAttribute("normal")) withNorm++;
      const mats = Array.isArray(n.material) ? n.material : [n.material];
      mats.forEach((m) => {
        if (!m) return;
        const t = m.type || m.constructor?.name || "?";
        matTypes[t] = (matTypes[t] || 0) + 1;
        if (m.flatShading) flatMats++;
        if (m.map) {
          mapsTotal++;
          const nearest = 1003; // THREE.NearestFilter
          if (m.map.generateMipmaps === false && m.map.minFilter === nearest) mapsNoMip++;
          if (m.map.image) {
            mapW = Math.max(mapW, m.map.image.width || m.map.image.videoWidth || 0);
            mapH = Math.max(mapH, m.map.image.height || m.map.image.videoHeight || 0);
          }
        }
      });
    });
    const mv = document.getElementById("main-viewer");
    return {
      meshes,
      withNorm,
      flatMats,
      matTypes,
      mapsTotal,
      mapsNoMip,
      mapW,
      mapH,
      shadowIntensity: mv ? mv.getAttribute("shadow-intensity") : null,
      matcapPreview: !!(sc.userData && sc.userData.sfMatcapPreview),
    };
  });
}

async function shot(page, name) {
  const viewer = page.locator("#main-viewer, model-viewer, canvas").first();
  const out = path.join(RUNS, name);
  // full page of manager
  await page.screenshot({ path: out, fullPage: false });
  return out;
}

async function main() {
  fs.mkdirSync(RUNS, { recursive: true });
  if (!fs.existsSync(OURS)) throw new Error("missing " + OURS);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(MANAGER, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => typeof window.__AGENT_LOAD_GLB_BUFFER__ === "function", null, {
    timeout: 30000,
  });

  // Prefer PBR；预览勿压贴图（与页面默认 1024 限制脱钩）
  await page.evaluate(() => {
    localStorage.setItem("prefer_pbr_preview", "1");
    localStorage.setItem("light_mode", "natural");
    const el = document.getElementById("check-prefer-pbr");
    if (el) el.checked = true;
    const tex = document.getElementById("sel-tex-size");
    if (tex) tex.value = "0";
    const mv = document.getElementById("main-viewer");
    if (mv) mv.setAttribute("shadow-intensity", "0");
  });

  await loadGlb(page, OURS, "human02_parts_color_tex.glb");
  const oursProbe = await probe(page);
  const oursShot = await shot(page, "skull-tex-manager-ours.png");

  await loadGlb(page, ORIG, "human02_raw.glb");
  const origProbe = await probe(page);
  const origShot = await shot(page, "skull-tex-manager-orig.png");

  await browser.close();

  const ok =
    oursProbe.withNorm === oursProbe.meshes &&
    oursProbe.meshes >= 1 &&
    oursProbe.flatMats === 0 &&
    (oursProbe.mapsTotal === 0 || oursProbe.mapsNoMip === oursProbe.mapsTotal) &&
    (oursProbe.mapW || 0) >= 2048 &&
    String(oursProbe.shadowIntensity || "0") === "0";

  const report = {
    ok,
    oursProbe,
    origProbe,
    oursShot,
    origShot,
    note: "NORMAL + NEAREST无mipmap + 贴图≥2048 + 柔和光无阴影",
  };
  fs.writeFileSync(path.join(RUNS, "skull-tex-manager-report.json"), JSON.stringify(report, null, 2));
  console.log(ok ? "SELFTEST_OK" : "SELFTEST_FAIL", JSON.stringify(report));
  if (!ok) process.exit(1);
}

main().catch((e) => {
  console.error("SELFTEST_FAIL", e);
  process.exit(1);
});
