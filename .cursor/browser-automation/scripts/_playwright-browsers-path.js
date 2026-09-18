/**
 * 默认把 Playwright 浏览器放到 D 盘，避免占 C 盘。
 * 须在 require('playwright') 之前加载。
 * 可用环境变量 PLAYWRIGHT_BROWSERS_PATH 覆盖。
 */
const path = require('path');
if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = 'D:/tools/ms-playwright';
}
module.exports = { browsersPath: process.env.PLAYWRIGHT_BROWSERS_PATH };
