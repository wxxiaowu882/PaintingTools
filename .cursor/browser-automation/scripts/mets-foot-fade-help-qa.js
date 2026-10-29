/**
 * 验收：? 帮助面板实色底；底部词库·进度；切词短促淡入淡出
 * 先 serve dist :8787，再：node scripts/mets-foot-fade-help-qa.js
 */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const BASE = process.env.METS_URL || "http://127.0.0.1:8787/";
const outDir = path.join(__dirname, "..", "runs", "mets-foot-fade-help-qa");
fs.mkdirSync(outDir, { recursive: true });

(async () => {
  const browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || "msedge",
    headless: true,
  });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  const logs = [];
  page.on("pageerror", (e) => logs.push("PAGEERROR " + e.message));

  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.evaluate(() => {
    localStorage.clear();
    try {
      indexedDB.deleteDatabase("mets-l2-vocab");
    } catch (_) {}
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".pack-kind-seg", { timeout: 20000 });

  const toggle = page.locator(".pack-list-head .pack-link");
  if ((await toggle.innerText()) === "全选") await toggle.click();
  const first = page.locator(".pack-check-body input").first();
  if (!(await first.isChecked())) await first.check();
  await page.click(".pack-enter-btn");
  await page.waitForSelector(".immerse-root", { timeout: 12000 });

  // 默认列 → 切中英
  await page.locator(".immerse-mode-btn", { hasText: /^中英$/ }).click();
  await page.waitForSelector(".immerse-stage .flash-en", { timeout: 8000 });

  const foot1 = await page.locator(".immerse-foot").innerText();
  if (!foot1 || !/\d+\s*\/\s*\d+/.test(foot1)) {
    throw new Error("flash foot missing progress: " + foot1);
  }

  // 帮助面板：打开并读计算样式（模拟 iOS 关注的 background-color）
  await page.click('[aria-label="操作说明"]');
  await page.waitForSelector(".immerse-help-panel:not([hidden])", { timeout: 5000 });
  const helpCss = await page.evaluate(() => {
    const el = document.querySelector(".immerse-help-panel");
    const cs = getComputedStyle(el);
    return {
      bg: cs.backgroundColor,
      bgImg: cs.backgroundImage,
      opacity: cs.opacity,
      color: cs.color,
      text: (el.textContent || "").slice(0, 40),
    };
  });
  await page.screenshot({ path: path.join(outDir, "01-help-panel.png") });

  const rgba = helpCss.bg.match(/rgba?\(([^)]+)\)/);
  if (!rgba) throw new Error("help bg not rgb: " + helpCss.bg);
  const parts = rgba[1].split(",").map((x) => parseFloat(x.trim()));
  const alpha = parts.length === 4 ? parts[3] : 1;
  // 实色：alpha≈1，且非全透明
  if (alpha < 0.95) throw new Error("help panel transparent alpha=" + alpha + " bg=" + helpCss.bg);
  if (parts[0] + parts[1] + parts[2] < 10 && alpha < 0.5) {
    throw new Error("help panel too dark/transparent " + helpCss.bg);
  }

  // 关帮助，测淡入淡出 class
  await page.click(".immerse-stage");
  await page.waitForTimeout(200);

  const fadeSeen = await page.evaluate(async () => {
    const card = document.querySelector(".immerse-stage");
    if (!card) return { ok: false, reason: "no card" };
    let sawFade = false;
    const mo = new MutationObserver(() => {
      if (card.classList.contains("is-fading")) sawFade = true;
    });
    mo.observe(card, { attributes: true, attributeFilter: ["class"] });
    // 点右侧切词
    const r = card.getBoundingClientRect();
    const x = r.left + r.width * 0.85;
    const y = r.top + r.height * 0.5;
    card.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        clientX: x,
        clientY: y,
        pointerId: 1,
        pointerType: "touch",
      })
    );
    card.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        clientX: x,
        clientY: y,
        pointerId: 1,
        pointerType: "touch",
      })
    );
    await new Promise((r) => setTimeout(r, 220));
    mo.disconnect();
    const foot = document.querySelector(".immerse-foot")?.textContent || "";
    return { ok: true, sawFade, foot };
  });

  await page.screenshot({ path: path.join(outDir, "02-flash-foot.png") });

  // 英模式 foot
  await page.locator(".immerse-mode-btn", { hasText: /^英$/ }).click();
  await page.waitForSelector(".immerse-stage", { timeout: 8000 });
  const footEn = await page.locator(".immerse-foot").innerText();
  await page.screenshot({ path: path.join(outDir, "03-recall-foot.png") });

  // 列模式 foot
  await page.locator(".immerse-mode-btn", { hasText: /^列$/ }).click();
  await page.waitForSelector(".immerse-list-mode", { timeout: 8000 });
  const footList = await page.locator(".immerse-foot").innerText();
  await page.screenshot({ path: path.join(outDir, "04-list-foot.png") });

  const result = {
    ok: true,
    foot1,
    helpCss,
    fadeSeen,
    footEn,
    footList,
    logs,
  };
  console.log(JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(outDir, "result.json"), JSON.stringify(result, null, 2));
  await browser.close();

  if (!fadeSeen.sawFade) throw new Error("did not observe is-fading on word change");
  if (!/\d+\s*\/\s*\d+/.test(footEn)) throw new Error("recall foot bad: " + footEn);
  if (!/词/.test(footList)) throw new Error("list foot bad: " + footList);
  if (logs.some((l) => l.startsWith("PAGEERROR"))) process.exit(2);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
