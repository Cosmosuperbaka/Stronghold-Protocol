# 项目约定（私有分支 local-tools）

上游给 AI 助手的入口是 [AGENTS.md](AGENTS.md)（必读文档、硬性规则、验证方法），和本文件冲突时以本文件为准。

先读 [docs/LOCAL-DEV.md](docs/LOCAL-DEV.md)：本地改动清单、对局引擎速览、回档与控制台的实现、测试和已知坑。
进行中的任务和接口要点见 [docs/HANDOFF.md](docs/HANDOFF.md)。

- 分支：在 `local-tools` 上开发，推到 `origin`（私有库）。`master` 只跟踪 `upstream`，不改。
- 文档用简体中文，代码和注释用英文（沿用上游约定）。
- 对局逻辑里不用 `Math.random` / `Date.now`：随机走 `m.rng*`，计时走 `m.later` / `m.setDeadline`，时间走 `m.sched.now()`。
- 改玩家状态后 `ps.dirty()`，改公共状态后 `m.markPublic()`；外部入口包在 `m.guard()` 里。
- 给 `Match` 加回合内会变的字段时，同步更新 `server/match/rewind.js` 的 `MATCH_KEYS`，然后跑 `node --test test/match/rewind.test.js`。
- 改完跑相关测试；全量 `node --test` 约 10 分钟，不要同时开两份（性能用例会超时）。
- 本地预览用 3005 端口（`.claude/launch.json` 的 `stronghold-dev`），3000 通常是正在开服的进程，别动它。
