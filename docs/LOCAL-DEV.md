# 本地开发笔记（私有分支）

这份文档记录本仓库在上游 [sganggs/Stronghold-Protocol](https://github.com/sganggs/Stronghold-Protocol) 之上做的改动，以及读代码时摸清的结构和坑，方便之后继续开发。上游自己的架构文档见 [DESIGN.md](DESIGN.md)（总体）、[META.md](META.md)（对局与经济）、[SIM.md](SIM.md)（战斗模拟）。

## 1. 仓库与分支

| 远程 | 地址 | 用途 |
|---|---|---|
| `origin` | `zhewang448/Stronghold-Protocol`（私有） | 自己的改动推到这里 |
| `upstream` | `sganggs/Stronghold-Protocol` | 拉官方更新 |

- 工作分支 `local-tools`，私有仓库的默认分支也是它。`master` 只跟踪上游，不在上面改。
- 同步上游：`git fetch upstream` → `git merge upstream/master` → `npm install` → `npm run setup`（上游常会加素材）→ `node --test`。
- 素材 `public/assets/`、`.cache/`、`.claude/` 都在 `.gitignore` 里，不进仓库。新机器 clone 后要先 `npm install && npm run setup`。

## 2. 本地新增了什么

| 文件 | 作用 |
|---|---|
| `scripts/start-tunnel.bat` / `.mjs` | 一键开服 + cloudflared 公网隧道，列出地址，持续输出日志。详见 [scripts/README.md](../scripts/README.md) |
| `scripts/stop-server.bat` / `free-port.mjs` | 释放游戏端口（结束服务器和指向它的隧道），仅 Windows |
| `server/match/rewind.js` | 回到任一回合的休整期开始（快照 + 恢复） |
| `server/admin.js` / `admin.html` | 本机主机控制台（HTTP API + 单页界面） |
| `server/sim/rng.js` | 加了 `rng.setState()`，回档用 |
| `server/match/Match.js` | 构造函数里加了 `prepSnapshots`（`Map<回合, 快照>`） |
| `server/match/match/prep.js` | `enterPrep()` 开头调用 `capturePrep()`（0.2.0 把 `Match` 的方法拆到了 `server/match/match/*.js`） |
| `server/http/boot.js` | `runMain()` 里启动控制台，打印 `Console:` 地址（0.2.0 把启动代码从 `server/index.js` 拆到了 `server/http/`） |
| `test/match/rewind.test.js`、`test/admin.test.js` | 对应的测试 |
| `docs/LOCAL-CHANGELOG.md` | 本分支的更新记录（上游的 `CHANGELOG.md` 不改，避免合并上游时冲突） |

## 3. 对局引擎速览

核心在 `server/match/`：`Match.js`（构造函数，以及平台和对局之间的接口契约，改之前先读一遍）和 `PlayerState.js`（每个玩家的经济、棋盘、手牌、羁绊）。0.2.0 起两者的方法分别拆在 `server/match/match/*.js` 和 `server/match/player/*.js`，启动时装到原型上（同名方法定义两次会直接报错）。

### 阶段流转

```
LOBBY → INFO_CHECK → BAND_DRAFT → BATTLE_CHECK
  → startRound(r): ROUND_START → [SP_DRAFT 机变，仅 spRounds] → PREP 休整期
  → endPrep(): COMBAT → [UNITE 联防] → SETTLE → afterSettle() → startRound(r + 1)
       r == bossRound   → FINAL_ASSAULT
       r == hiddenRound → HIDDEN_CORE
  → finish() → RESULT（调用 onEnd，房间回到大厅，随后 dispose）
```

对应方法：`startRound`、`enterSpDraft`、`enterPrep`、`endPrep`、`startCombat`、`startUnite`、`settle`、`afterSettle`、`startFinalAssault`、`finish`。

### 几个必须遵守的机制

- **随机数**：全部来自 `rngSetup / rngShop / rngWaves / rngDraft / rngBots / rngMeta` 六条流（`server/sim/rng.js`，mulberry32，状态只有一个 uint32）。战斗的种子由 `deriveSeed(seed, 回合+座位)` 派生。不要在对局逻辑里用 `Math.random`，否则回档和测试的确定性都会坏掉。
- **计时器**：一律用 `m.later(ms, fn)`（记在 `m._timers` 里，`dispose` / 回档时能统一清掉）。阶段倒计时用 `m.setDeadline(秒, fn)`。
- **错误隔离与推送**：外部入口都包在 `m.guard(fn)` 里，它负责捕获异常并在结束时 `flush()`。改了玩家状态要调 `ps.dirty()`（→ `m.markPrivate`），改了公共状态要调 `m.markPublic()`，然后由 flush 统一下发 `m.private` / `m.public`。
- **全量同步**：`m.onReconnect(playerId)` 会重发完整的 `m.public`、`m.private` 和进行中的战斗；把 `ps._lastPriv = null` 再 `dirty()` 也能强制重发 `m.private`。
- **客户端战斗**：默认战斗在玩家浏览器里模拟（`public/js/battle/runner.js`），服务器只校验结果。`battleId` 带递增的 `_battleSeq`，过期的 `b.progress` / `b.result` 会被静默忽略。浏览器在阶段变成 `PREP` 等非战斗阶段时会丢掉本地战斗（`runner.js` 的 store 订阅），回档正是靠这一点让前端自动回到休整期画面。
- **AI**：`server/match/bot.js`，由 `scheduleBotPrep` 等方法分片调度，用 `ps._botPrepToken` / `m._turnToken` 判断旧任务是否作废。

## 4. 回档（rewind.js）

### 原理

`enterPrep()` 一开头（在 `onPrepStart` 效果之前）调用 `capturePrep(m)`，用一次 `structuredClone` 存下：

- 每个 `PlayerState` 的全部自有字段，减去 `PS_SKIP` 里的那些（引用、身份、连接状态、缓存、配装）
- `MATCH_KEYS` 里的对局级字段（回合、波次、上回合结果、团队 LP 等）
- 共享卡池 `m.pool.entries`
- 六条 rng 的状态
- `bossPool`、`_uniteBounds` 这类类实例或含 `PlayerState` 引用的对象，按引用保存（它们只会被替换，不会被原地修改）

`rewindToPrep(m, round)`（不传 round 取最新一份）先停掉一切进行中的东西（`runner`、客户端战斗计时器、`_timers`、阶段/轮次计时器），把快照写回原来的对象上，再调一次 `enterPrep()`。因为 rng 状态也恢复了，`onPrepStart` 效果和 AI 的行为会和第一次完全一样。最后所有人收到全量同步。

每个休整期都存一份（一局最多 15 份，每份约 25 KB）。回到第 R 回合时删掉 `> R` 的快照（那条时间线作废），R 自己那份由随后的 `enterPrep()` 重新生成，所以可以反复回到同一个起点。快照在机变之后才拍，回档保留那回合已选的机变卡。

### 故意不回滚的字段

| 字段 | 原因 |
|---|---|
| `uidSeq` | 浏览器里迟到的操作带着旧 uid，只会命中同一个棋子或找不到，不会误操作到别的棋子 |
| `_battleSeq` | 被中止的战斗迟到的上报对不上任何新战场，被忽略 |
| `_turnToken`、`ps._botPrepToken` | 旧的 AI 任务和选秀计时器自动作废 |
| `connected` / `left` / `autoplay` / `loadout` | 连接状态以现在为准，配装在开局后就锁定 |

### 以后加新状态时

- 给 `PlayerState` 加普通字段：**自动**进快照，不用改什么。如果是缓存或不该回滚的东西，加进 `PS_SKIP`。
- `PlayerState` 上的**类实例**字段不能直接进快照：`structuredClone` 会丢掉原型，恢复后调用方法就报 `is not a function`。要么开局后不变、加进 `PS_SKIP` 按引用保留（0.2.0 的 `diy`、`standIns` 等），要么像 `diyStock` 那样把里面的数据单独克隆、恢复时写回原实例。
- 给 `Match` 加一个回合内会变的字段：要加进 `MATCH_KEYS`。如果是类实例，像 `bossPool` 那样放进 `refs`。
- 函数类型的自有属性会被跳过（`audit.js` 和测试会在实例上包装方法，这些不是状态）。
- 跑 `node --test test/match/rewind.test.js`。第一个用例「回档后重打 ≡ 直接打完」会抓出漏掉的状态：我验证过，故意不恢复卡池或 rng，它都会失败。

### 限制

- 对局结束后（`m.ended`）不能回档，房间已经回到大厅。
- 同盟模式下卡池是全队共享的，只能整局一起回档。
- 每回合多一次 `structuredClone`，第 12 回合 1 真人 + 3 AI 实测约 2.3 ms。

## 5. 主机控制台（admin.js）

服务器启动时开在 `127.0.0.1:<PORT+100>`（默认 3100），`SP_ADMIN_PORT` 改端口，`SP_ADMIN=0` 关闭。用 `start-tunnel.bat` 启动时，地址会出现在 `[server]` 日志里。

### 安全

三层，缺一不可：只监听 127.0.0.1（局域网和隧道都到不了）；`/api/*` 必须带 `X-Admin-Token`（每次启动随机生成，嵌在页面里）；`Host` 头必须是控制台自己的 localhost 地址（防止浏览器里打开的其他网站通过 DNS rebinding 调用）。`test/admin.test.js` 覆盖了这三条。

### API

| 请求 | 说明 |
|---|---|
| `GET /` | 控制台页面 |
| `GET /api/rooms` | 所有房间、对局阶段、玩家数据 |
| `GET /api/catalog?room=` | 当前模式可发放的干员和道具 |
| `POST /api/action` | `{ room, action, playerId?, value? }` → `{ ok }` 或 `{ error }` |

对局操作：`rewind`（`value` 为回合数，空则最新）、`endPrep`、`pause`（仅独立模拟）、`endMatch`、`reroll`（重新随机本回合敌人，仅战斗开始前）、`battleWin` / `battleLose`（`{ field, n? }`，仅客户端战斗）、`timerScale`（0.1–10）。

玩家操作：`funds`（增减）、`lp`（设定）、`level`（设定）、`refresh`（+1 免费刷新）、`chess` / `item`（发放）、`bondAdd` / `bondSet` / `bondBonus`（`{ bond, n }`）、`autoplay`（1/0，仅真人）、`effectRemove` / `bountyRemove`（效果 / 悬赏 id）、`card`（机变卡 effectId）、`pieceRemove` / `piecePromote`（棋子 uid）、`pieceEquip`（`{ target, item }`）。房间操作：`closeRoom`。

`/api/rooms` 的每个玩家带 `bonds`、`effects`、`bounties`、`pieces`、`enemies`（页面上的「详情」）；`/api/catalog` 另有 `cards`（可补发的机变卡）。

- **会触发游戏效果的**：`bondAdd`（走 `addLayers`，派发 `onLayers`）、`card`（走 `applyCard`，全队卡会作用到所有存活队友）、`pieceEquip`（派发 `onEquip`，能合成时直接合成）。其余都是直接改数据。
- **重新随机敌人**：每回合的敌人条目在开局时由 `setupMatchWaves` 的日程定死（`roundPick` 读 `picks[round]`），只重建波次会得到一模一样的结果。所以 `reroll` 用 `pickRoundEntry` 从 `rngWaves` 在同一阵营类型里重抽一个条目，再按它重建波次（boss 回合同样处理 `bossWaves`）。之后的 `rngWaves` 随机流会跟着变，回档能恢复。
- **判负**：普通战场按 `n` 条计数漏怪生成结果，结算扣 `min(10, n)`；同盟模式下这些漏怪会像真的一样进入联防。联防判胜等于全部击杀，判负等于没人支援（按漏怪者自己的漏怪数扣血）。领袖战判胜把共享血池清零，判负把同盟 LP 清零，两者都会结束所有领袖战场。

### 加一个新操作

在 `admin.js` 的 `PLAYER_ACTIONS` 或 `MATCH_ACTIONS` 表里加一项，签名分别是 `(m, ps, value)` 和 `(m, value)`，返回 `OK` 或 `{ error }`。它会在 `m.guard()` 里执行，所以异常会被隔离并记日志，结束后自动推送视图。直接改字段后记得 `ps.dirty()`，影响羁绊或棋盘合法性的改动还要 `ps.recompute()`。页面上的按钮或输入框在 `admin.html` 的 `roomCard` / `playerRow` 里加，用 `data-click` 或 `data-act` 属性接到同一个 `act()` 函数。

现有操作直接改数据，不扣金币、不触发 `onLevelUp` 之类的效果。需要「像玩家一样操作」时，改成调用 `ps.levelUp()` 这类方法即可。

## 6. 测试

- 全量：`node --test`，约 3500 项，在这台机器上要 10 分钟左右。
- 单个文件：`node --test test/match/rewind.test.js`。
- 对局测试用 `test/match/harness.js` 的 `makeMatch()`：虚拟时钟（`VirtualScheduler`），完全确定。常用 `h.toPrep(r)`、`h.drive(pred)`（自动替真人确认、选策略、就绪）。注意 `h.runToEnd()` **不会**替真人操作，有真人座位时要用 `h.drive(() => h.ended != null)`。
- `node tools/matchrun.mjs --check` 可以跑整局并检查不变量。

### 已知的失败

| 测试 | 原因 |
|---|---|
| `test/assets.test.js` 的 manifest 检查 | 公开镜像缺约 31 个文件（几首 BGM、部分音效、几个敌人图标），`npm run setup` 重试多次也下不到。和代码无关 |
| `robustness.test.js` 的 boss 战场性能用例（偶尔还有 `realtime.test.js`） | 对 CPU 负载敏感。单独跑约 0.12 ms/tick（门槛 0.5 ms），全量测试里各文件并发跑时可能到 3.8 ms 而失败。它只测战斗模拟，不经过回档代码；合并后、加回档前那次全量是通过的，推测是新增的整局测试加重了并发负载，没有进一步验证 |

## 7. 踩过的坑

- **模板字符串 `DATA_SHIM_JS`**（0.2.0 起在 `server/http/static.js`）内容里有 `import { getSimData } from './sim/simdata.js';` 这一行。按文本定位插入 import 时容易插进字符串里（我就犯过一次，表现为 `startAdmin is not defined`）。真正的 import 区在文件顶部。
- **`structuredClone` 克隆不了函数**：`audit.js` 会把 `PlayerState` 的方法包装后挂到实例上，所以快照要跳过函数属性。
- **端口 3000 被旧进程占着**：先跑 `scripts/stop-server.bat`。预览/测试用别的端口（`.claude/launch.json` 里的 `stronghold-dev` 用 3005）。
- **合并上游后**要重新 `npm run setup`，上游会新增素材清单，否则素材测试会多出一批失败。setup 和 `npm install` 会改写 `data/assets.json`、`package-lock.json`，合并时用上游的版本（`git checkout -- data/assets.json package-lock.json`）。
