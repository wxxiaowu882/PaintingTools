# 站内视频课 · 课表约定（C6）

## 权威试播课表

- `demo-catalog.json`：学习页 `/CourseLearn` 本地/测站读取。**正式站录播未开放前**：学习页只「筹备中」、预告页无「学习入口」、play-url 不签发（见路线图 §4.5.2）。

## 字段（单课）

| 字段 | 含义 |
|------|------|
| `lessonId` | 播放接口 `play-url?lessonId=` 用的课号 |
| `uid` | 与会员课表对齐的稳定编号（demo 阶段可与 lessonId 相同） |
| `index` | 目录排序（从 1） |
| `title` | 课名（不含编号前缀亦可；UI 可拼 `01 ·`） |
| `durationSec` | 时长秒 |
| `r2Key` | R2 对象键，默认形态 `course/{lessonId}/v1/main.mp4` |
| `demoSrc` / `demoSrcPortrait` | 仅本地试播；**不进 R2** |

## 可售课包（运营开通）

- `packs.json`：运营台「开通学员」下拉来源；`packId` 与课表 `courseId` 对齐。
- 开通写权说明：`ops-student-grant.md`（三年 Pro 覆盖重算 + 课包永久）。

## 与会员

- `require`：旧稿（如 `member`）；**现行口径以课包清单为准**（Pro ≠ 自动拥有未买课）。  
- **play-url**：R2 正课短时链已验 `coursePacks`（`functions/course/pack-access.js`）；`demo*` 本地样片不验。学习页 UI 锁态提示仍待接。
- 禁止另起一套与肖像/Solid 冲突的 uid 规则；真课上架时复用会员 uid 口径。

## 与 C3

- 有 `COURSE_R2_*` 时：`play-url` 按 `r2Key`（或默认键）签短时 URL。
- 无 Secrets：`lessonId` 以 `demo` 开头走本地样片路径。

## 本机进度（C2 / C8 轻量）

- 学习页用 `localStorage` 键 `wuxiao.courseLearn.progress.v1`，按 `courseId` → `lessonId` 记播放位置与上次打开的课。
- **不上云、不跨设备**；清站点数据即丢。接近片尾（约最后 2 秒）视为看完，下次从头。
- URL 带 `?lesson=` 时优先该课，不再用「上次打开的课」覆盖。

## 测站 R2 冒烟（C3）

- 课表末课 `smoke-land`：**无** `demoSrc`，学习页会调 `/api/course/play-url`。
- 测站已配 Secrets 时返回 `source:r2` 短时链；`demo*` 课仍强制本地样片路径。
- 本地 static-server 对任意 lessonId 仍预演 demo 样片（无真签）。
