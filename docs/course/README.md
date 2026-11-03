# 站内视频课 · 课表约定（C6）

## 权威试播课表

- `demo-catalog.json`：学习页 `/CourseLearn` 本地/测站读取（正式站学习页仍筹备中）。

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

## 与会员

- `require`：课程级门槛草稿（如 `member`）；细锁课尚未接 Membership。
- 禁止另起一套与肖像/Solid 冲突的 uid 规则；真课上架时复用会员 uid 口径。

## 与 C3

- 有 `COURSE_R2_*` 时：`play-url` 按 `r2Key`（或默认键）签短时 URL。
- 无 Secrets：`lessonId` 以 `demo` 开头走本地样片路径。
