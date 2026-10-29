/**
 * 金勋章 / 有效驱动条 / 近10次去重 / 成就页 icon
 */
require("./_playwright-browsers-path");
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const BASE =
  process.env.METS_URL ||
  "http://127.0.0.1:18080/%E4%B8%B4%E6%97%B6_METS%E4%BA%8C%E7%BA%A7%E5%A4%87%E8%80%83/05_%E8%83%8C%E8%AF%8D%E7%BD%91%E9%A1%B5/dist/";
const outDir = path.join(__dirname, "..", "runs", "mets-gold-medal-qa");
fs.mkdirSync(outDir, { recursive: true });

const report = { ok: true, checks: [], errors: [] };
function check(name, pass, detail) {
  report.checks.push({ name, pass: !!pass, detail: detail || "" });
  if (!pass) report.ok = false;
}

(async () => {
  const browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || "msedge",
    headless: true,
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on("pageerror", (e) => report.errors.push(String(e.message || e)));

  await page.goto(BASE, { waitUntil: "networkidle", timeout: 60000 });
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem(
      "mets-l2-settings-v1",
      JSON.stringify({
        lastStudyMode: "recallZh",
        immerseAudioOn: true,
        voiceChannel: "male",
        achieveDailyValidCap: 3,
        achieveStreakNeed: 10,
        planDailyRounds: 1,
        planRoundSize: 3,
      })
    );
  });
  await page.reload({ waitUntil: "networkidle", timeout: 60000 });
  await page.locator("button:has-text('进入学习')").first().click();
  await page.waitForSelector(".immerse-root", { timeout: 15000 });
  await page.locator(".immerse-mode-btn", { hasText: "英" }).click();
  await page.waitForTimeout(400);

  check(
    "英有进度条",
    (await page.locator(".immerse-plan-bar").count()) === 1
  );
  check(
    "默认1枚勋章可见",
    await page.evaluate(() => {
      const slots = [...document.querySelectorAll(".immerse-plan-medal-slot")];
      return slots.filter((s) => !s.hidden).length === 1;
    })
  );

  const next = async () => {
    const box = await page.locator(".immerse-stage").boundingBox();
    await page.mouse.click(
      box.x + box.width * 0.85,
      box.y + box.height * 0.55
    );
    await page.waitForTimeout(300);
  };

  for (let i = 0; i < 3; i++) await next();
  let dayRow = await page.evaluate(() => {
    const days = JSON.parse(
      localStorage.getItem("mets-l2-achieve-days-v1") || "{}"
    );
    const k = Object.keys(days)[0];
    return { k, row: days[k] };
  });
  check("有效=3", dayRow.row?.validSwitches === 3, JSON.stringify(dayRow.row));
  check("金牌=1", dayRow.row?.goldCount === 1, JSON.stringify(dayRow.row));
  check(
    "勋章变金",
    (await page.locator(".immerse-medal--onbar.is-gold").count()) >= 1
  );

  for (let i = 0; i < 3; i++) await next();
  dayRow = await page.evaluate(() => {
    const days = JSON.parse(
      localStorage.getItem("mets-l2-achieve-days-v1") || "{}"
    );
    const k = Object.keys(days)[0];
    return { k, row: days[k] };
  });
  check("有效=6", dayRow.row?.validSwitches === 6, JSON.stringify(dayRow.row));
  check("金牌=2", dayRow.row?.goldCount === 2, JSON.stringify(dayRow.row));
  check(
    "两枚可见",
    await page.evaluate(
      () =>
        [...document.querySelectorAll(".immerse-plan-medal-slot")].filter(
          (s) => !s.hidden
        ).length >= 2
    )
  );

  // 近10次：把当前词 id 放进窗，再 next，有效不应涨
  const blocked = await page.evaluate(() => {
    const days = JSON.parse(
      localStorage.getItem("mets-l2-achieve-days-v1") || "{}"
    );
    const k = Object.keys(days)[0];
    const before = days[k].validSwitches;
    const planBefore = JSON.parse(
      localStorage.getItem("mets-l2-achieve-plan-v1") || "{}"
    ).ticks;
    // 从 resume / 词面拿不到 id 时：把 recent 填满假 id，并把「即将离开」的词
    // 用页面内部：读 flash 文本不够。改为：读取 recent 最后离开的词，再强制
    // 下一次 leave 仍是它——通过把 recent 设为仅含「下一词」很难。
    // 简化：直接调用模块不可行。改为设置 recent 为当前 deck 下一词…
    // 用自定义事件：把 recent 设成包含一个特殊标记，再在 leave 前注入。
    return { before, planBefore, dayKey: k };
  });

  // 注入：拦截下一次 leave 的词 id——先 next 一次拿到 recent 末位，再把它塞满窗后模拟
  await next();
  const afterOne = await page.evaluate((dayKey) => {
    const days = JSON.parse(
      localStorage.getItem("mets-l2-achieve-days-v1") || "{}"
    );
    const recent = JSON.parse(
      localStorage.getItem("mets-l2-achieve-recent-v1") || '{"ids":[]}'
    );
    const lastId = recent.ids[recent.ids.length - 1];
    const beforeV = days[dayKey].validSwitches;
    const beforeP = JSON.parse(
      localStorage.getItem("mets-l2-achieve-plan-v1") || "{}"
    ).ticks;
    // 填满窗口全是 lastId，保证下一词若仍是新词会计；我们改为：
    // 把 recent 设为含 lastId，再通过 go 到 lastId 再离开——复杂。
    // 直接：假造 recent 含「下一次要刷的词」。读 plan 无关。
    // 最稳：把 recent 设为 ids=[即将 leave 的词]。当前 idx 词将在 next 时 leave。
    // 无法在 evaluate 外知 id。用：recent.ids 末尾是刚 leave 的；
    // 用 prev 回到它再 next leave 它第二次。
    return { lastId, beforeV, beforeP, recent };
  }, dayRow.k);

  // prev 回到刚 leave 的词，再 next 再次 leave —— 应被窗挡住
  const box = await page.locator(".immerse-stage").boundingBox();
  await page.mouse.click(box.x + box.width * 0.15, box.y + box.height * 0.55);
  await page.waitForTimeout(300);
  await page.mouse.click(box.x + box.width * 0.85, box.y + box.height * 0.55);
  await page.waitForTimeout(300);

  const afterDedupe = await page.evaluate((dayKey) => {
    const days = JSON.parse(
      localStorage.getItem("mets-l2-achieve-days-v1") || "{}"
    );
    const plan = JSON.parse(
      localStorage.getItem("mets-l2-achieve-plan-v1") || "{}"
    );
    return {
      valid: days[dayKey].validSwitches,
      ticks: plan.ticks,
    };
  }, dayRow.k);

  check(
    "二次离开同词有效不增",
    afterDedupe.valid === afterOne.beforeV,
    `before=${afterOne.beforeV} after=${afterDedupe.valid} lastId=${afterOne.lastId}`
  );
  check(
    "二次离开同词计划不增",
    afterDedupe.ticks === afterOne.beforeP,
    `before=${afterOne.beforeP} after=${afterDedupe.ticks}`
  );

  await page.screenshot({
    path: path.join(outDir, "01-two-gold.png"),
    fullPage: false,
  });

  await page.locator('.immerse-medal--onbar[data-medal-index="0"]').click({
    force: true,
  });
  await page.waitForTimeout(500);
  check(
    "成就页勋章列",
    (await page.locator("th:has-text('勋章')").count()) === 1
  );
  check(
    "成就页有亮金点",
    (await page.locator(".achieve-gold-ico.is-on").count()) >= 1
  );
  await page.screenshot({
    path: path.join(outDir, "02-achieve-path.png"),
    fullPage: false,
  });

  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await browser.close();
  fs.writeFileSync(
    path.join(outDir, "report.json"),
    JSON.stringify(report, null, 2)
  );
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok && report.errors.length === 0 ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
