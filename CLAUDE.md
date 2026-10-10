# 项目约定（扩展分支）

上游给 AI 助手的入口是 [AGENTS.md](AGENTS.md)（必读文档、硬性规则、验证方法），和本文件冲突时以本文件为准。

先读 [docs/LOCAL-DEV.md](docs/LOCAL-DEV.md)：本地改动清单、对局引擎速览、回档与控制台的实现、测试和已知坑。
项目交接（现状、运行、常见任务、待办、控制台接口）见 [docs/HANDOFF.md](docs/HANDOFF.md)。

- 分支：默认分支 `main` 已整合主机工具、联动干员、皮肤与预加载；新任务从 `main` 开功能分支，推到 `origin`。`master` 只跟踪 `upstream`，不改。
- 文档用简体中文，代码和注释用英文（沿用上游约定）。
- 对局逻辑里不用 `Math.random` / `Date.now`：随机走 `m.rng*`，计时走 `m.later` / `m.setDeadline`，时间走 `m.sched.now()`。
- 改玩家状态后 `ps.dirty()`，改公共状态后 `m.markPublic()`；外部入口包在 `m.guard()` 里。
- 给 `Match` 加回合内会变的字段时，同步更新 `server/match/rewind.js` 的 `MATCH_KEYS`，然后跑 `node --test test/match/rewind.test.js`。
- 改完跑相关测试；全量 `node --test` 约 10 分钟，不要同时开两份（性能用例会超时）。
- 本地预览选择空闲游戏端口和控制台端口，例如 `PORT=3005`、`SP_ADMIN_PORT=3105`；先检查占用，不停止已有服务，任务结束后只关闭自己启动的服务。
