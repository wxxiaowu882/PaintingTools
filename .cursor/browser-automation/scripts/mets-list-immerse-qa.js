/**
 * 验收看词沉浸：双击显隐列 + 可滚动 + 退出后主列表同步
 * 先 serve dist :8787，再：node scripts/mets-list-immerse-qa.js
 */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const BASE = process.env.METS_URL || "http://127.0.0.1:8787/";
const outDir = path.join(__dirname, "..", "runs", "mets-list-immerse-qa");
fs.mkdirSync(outDir, { recursive: true });

async function ensureStudyList(page) {
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector(".topbar, .main", { timeout: 20000 });
  await page.waitForTimeout(600);

  const packBtn = page.locator("#btn-pack:not([hidden])");
  if (await packBtn.count()) {
    // 已有词包：进看词即可
  } else {
    await page.waitForSelector(".pack-list-head", { timeout: 20000 });
    const toggle = page.locator(".pack-list-head .pack-link");
    if ((await toggle.innerText()) === "全选") await toggle.click();
    await page.click(".pack-enter-btn");
  }
  await page.waitForSelector(".mode-bar", { timeout: 15000 });
  const kan = page.locator(".mode-bar button:has-text('看词')");
  if (await kan.count()) await kan.click();
  await page.waitForSelector("#study-body .list-item .en-line", { timeout: 15000 });
}

async function openImmerse(page) {
  await page.click('#study-body [aria-label="沉浸模式"]');
  await page.waitForSelector(".immerse-root.immerse-list-mode", { timeout: 8000 });
  await page.waitForSelector(".immerse-list-scroll .list-item", { timeout: 5000 });
}

(async () => {
  const browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || "msedge",
    headless: true,
    hasTouch: true,
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  page.on("dialog", async (d) => d.accept());
  const logs = [];
  page.on("pageerror", (e) => logs.push("PAGEERROR " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error") logs.push("CONSOLE " + m.text());
  });

  await ensureStudyList(page);
  await openImmerse(page);
  await page.screenshot({ path: path.join(outDir, "01-immerse-both.png") });

  // —— 滚动：程序滚动 + 触控拖拽 ——
  const scrollProbe = await page.evaluate(async () => {
    const el = document.querySelector(".immerse-list-scroll");
    if (!el) return { ok: false, reason: "no-scroll" };
    const max = el.scrollHeight - el.clientHeight;
    el.scrollTop = 0;
    const before = el.scrollTop;
    el.scrollTop = Math.min(400, Math.max(0, max));
    const afterProg = el.scrollTop;

    // 模拟 touchmove：沉浸列表内不应被 preventDefault 死锁
    let defaultPrevented = null;
    const item = el.querySelector(".list-item") || el;
    const touch = new Touch({
      identifier: 1,
      target: item,
      clientX: 120,
      clientY: 300,
      pageX: 120,
      pageY: 300,
      screenX: 120,
      screenY: 300,
      radiusX: 1,
      radiusY: 1,
      rotationAngle: 0,
      force: 1,
    });
    const move = new TouchEvent("touchmove", {
      bubbles: true,
      cancelable: true,
      touches: [touch],
      targetTouches: [touch],
      changedTouches: [touch],
    });
    item.dispatchEvent(move);
    defaultPrevented = move.defaultPrevented;

    return {
      ok: true,
      max,
      before,
      afterProg,
      canProgScroll: afterProg > before || max < 50,
      touchDefaultPrevented: defaultPrevented,
      clientH: el.clientHeight,
      scrollH: el.scrollHeight,
    };
  });

  // 真实触控拖拽
  const box = await page.locator(".immerse-list-scroll").boundingBox();
  let afterSwipe = null;
  if (box) {
    await page.evaluate(() => {
      const el = document.querySelector(".immerse-list-scroll");
      if (el) el.scrollTop = 0;
    });
    const x = box.x + box.width / 2;
    const y = box.y + box.height * 0.7;
    await page.touchscreen.tap(x, y); // focus
    // Playwright 无直接 swipe API：用 touch 序列
    await page.evaluate(
      async ({ x, y }) => {
        const el = document.querySelector(".immerse-list-scroll");
        const target = el.querySelector(".list-item") || el;
        const fire = (type, cy, opts = {}) => {
          const t = new Touch({
            identifier: 9,
            target,
            clientX: x,
            clientY: cy,
            pageX: x,
            pageY: cy,
            screenX: x,
            screenY: cy,
            radiusX: 1,
            radiusY: 1,
            rotationAngle: 0,
            force: 1,
          });
          target.dispatchEvent(
            new TouchEvent(type, {
              bubbles: true,
              cancelable: true,
              touches: type === "touchend" ? [] : [t],
              targetTouches: type === "touchend" ? [] : [t],
              changedTouches: [t],
              ...opts,
            })
          );
        };
        fire("touchstart", y);
        for (let i = 1; i <= 8; i++) {
          fire("touchmove", y - i * 30);
          await new Promise((r) => setTimeout(r, 16));
        }
        fire("touchend", y - 240);
        // 原生滚动不会被合成 TouchEvent 驱动；再测轮滚
        el.scrollTop = 280;
        return el.scrollTop;
      },
      { x, y }
    );
    afterSwipe = await page.evaluate(
      () => document.querySelector(".immerse-list-scroll")?.scrollTop ?? -1
    );
  }

  if (!scrollProbe.ok || !scrollProbe.canProgScroll) {
    throw new Error("scroll container broken: " + JSON.stringify(scrollProbe));
  }
  if (scrollProbe.touchDefaultPrevented === true) {
    throw new Error(
      "touchmove still preventDefault inside list immerse: " +
        JSON.stringify(scrollProbe)
    );
  }

  // —— 双击左列：应收成仅中文 cols-zh ——
  await page.evaluate(() => {
    const el = document.querySelector(".immerse-list-scroll");
    if (el) el.scrollTop = 0;
  });
  const left = page.locator(".immerse-list-scroll .list-item .col-left").first();
  await left.dispatchEvent("pointerup", { button: 0, pointerType: "touch" });
  await page.waitForTimeout(80);
  await left.dispatchEvent("pointerup", { button: 0, pointerType: "touch" });
  await page.waitForTimeout(200);
  const afterHideLeft = await page.evaluate(() => {
    const ul = document.querySelector(".immerse-list-scroll .list-block");
    const settings = JSON.parse(
      localStorage.getItem("mets-l2-settings-v1") || "{}"
    );
    return {
      className: ul?.className || "",
      listCols: settings.listCols || null,
      hasColsZh: ul?.classList.contains("cols-zh") || false,
    };
  });
  await page.screenshot({ path: path.join(outDir, "02-immerse-cols-zh.png") });
  if (!afterHideLeft.hasColsZh) {
    throw new Error("double-tap left did not hide EN: " + JSON.stringify(afterHideLeft));
  }

  // —— 双击右列（可见）：应对调为仅英文 ——
  const right = page.locator(".immerse-list-scroll .list-item .col-right").first();
  await right.dispatchEvent("pointerup", { button: 0, pointerType: "touch" });
  await page.waitForTimeout(80);
  await right.dispatchEvent("pointerup", { button: 0, pointerType: "touch" });
  await page.waitForTimeout(200);
  const afterSwap = await page.evaluate(() => {
    const ul = document.querySelector(".immerse-list-scroll .list-block");
    const settings = JSON.parse(
      localStorage.getItem("mets-l2-settings-v1") || "{}"
    );
    return {
      className: ul?.className || "",
      listCols: settings.listCols || null,
      hasColsEn: ul?.classList.contains("cols-en") || false,
    };
  });
  await page.screenshot({ path: path.join(outDir, "03-immerse-cols-en.png") });
  if (!afterSwap.hasColsEn) {
    throw new Error("double-tap right did not swap to EN: " + JSON.stringify(afterSwap));
  }

  // —— 双击藏列（右列透明区）恢复双列 ——
  await right.dispatchEvent("pointerup", { button: 0, pointerType: "touch" });
  await page.waitForTimeout(80);
  await right.dispatchEvent("pointerup", { button: 0, pointerType: "touch" });
  await page.waitForTimeout(200);
  const afterBoth = await page.evaluate(() => {
    const ul = document.querySelector(".immerse-list-scroll .list-block");
    return {
      className: ul?.className || "",
      hasBoth: ul?.classList.contains("cols-both") || false,
    };
  });
  if (!afterBoth.hasBoth) {
    throw new Error("double-tap hidden col did not restore both: " + JSON.stringify(afterBoth));
  }

  // —— 退出：主列表应同步 listCols ——
  // 先再藏一次左列，退出后主列表应为 cols-zh
  await left.dispatchEvent("pointerup", { button: 0, pointerType: "touch" });
  await page.waitForTimeout(80);
  await left.dispatchEvent("pointerup", { button: 0, pointerType: "touch" });
  await page.waitForTimeout(200);
  await page.click('[aria-label="退出"]');
  await page.waitForSelector(".immerse-root", { state: "detached", timeout: 5000 });
  const mainSync = await page.evaluate(() => {
    const ul = document.querySelector("#study-body .list-block");
    return {
      className: ul?.className || "",
      hasColsZh: ul?.classList.contains("cols-zh") || false,
    };
  });
  await page.screenshot({ path: path.join(outDir, "04-exit-synced.png") });
  if (!mainSync.hasColsZh) {
    throw new Error("exit did not sync main list cols: " + JSON.stringify(mainSync));
  }

  // 复位双列，避免污染后续手工测
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem("mets-l2-settings-v1") || "{}");
    raw.listCols = "both";
    localStorage.setItem("mets-l2-settings-v1", JSON.stringify(raw));
  });

  const result = {
    ok: true,
    scrollProbe,
    afterSwipe,
    afterHideLeft,
    afterSwap,
    afterBoth,
    mainSync,
    logs,
  };
  console.log(JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(outDir, "result.json"), JSON.stringify(result, null, 2));
  await browser.close();
  if (logs.some((l) => l.startsWith("PAGEERROR"))) process.exit(2);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
