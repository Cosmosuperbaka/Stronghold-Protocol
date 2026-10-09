# 交接：主机控制台

最近更新 2026-10-08（第三期完成）。接手前先读 [CLAUDE.md](../CLAUDE.md) 和 [docs/LOCAL-DEV.md](LOCAL-DEV.md)：回档的原理、控制台的结构和安全措施、统计 / 敌人日程 / 休整期设置的实现、测试方法、踩过的坑都在里面，这里不重复。改动摘要见 [LOCAL-CHANGELOG.md](LOCAL-CHANGELOG.md)。

## 1. 当前状态

- 远程 `origin` 是私有库 `zhewang448/Stronghold-Protocol`，`upstream` 是原作者仓库。上游已合并到 v0.2.1（`a122fde`）。
- 2026-10-09：在临时分支 `local-tools-v0.2.2` 上合并 v0.2.2（`62eb113`）。只有 `CLAUDE.md` 冲突（上游新增了指向 `AGENTS.md` 的同名文件，保留本地内容并加一行指引）；本地挂钩（`waveSource`、`prepSeconds`、`capturePrep`、控制台启动）都自动合并保留。0.2.2 新增的 `ps.ops`（每名干员的潜能 / 练度，开局后锁定、冻结）加进了 `rewind.js` 的 `PS_SKIP`，`rewind.test.js` 加了对应用例；`ps.personalChoice`（教鞭三选一）是普通数据，自动进快照。
- 联动干员进自选池：焰狐龙梓兰已完成（同一临时分支）。做法、重新生成数据的步骤、合并上游时的注意事项见 LOCAL-DEV.md 第 8 节。其余 6 名（灰烬、艾拉、麒麟R夜刀、丰川祥子、结城理、玛露西尔）没有现成 kit，要从头写，用户还没说先做哪个。
- 第三期（含每回合干员伤害排行）都在 `local-tools` 上，已推到 `origin/local-tools`。合并 v0.2.1 时开的临时分支 `local-tools-v0.2.1` 已快进合入并删除（本地和远端）。
- 用户的规则：只有明确说了才提交；提交信息不加 Claude 署名；不直接推 `master`。
- 已验证（第三期）：`test/admin.test.js`（9 项）、`test/match/rewind.test.js`（4 项）通过；`test/match/` 全部加 i18n、文档、lobby 相关测试共 737 项，735 通过、0 失败、2 跳过。**没跑全量** `node --test`。浏览器里实测过曲线和悬停、每回合详情、上一局统计、对局记录页、敌人日程的指定、设置页的保存和预览。
- 端口 3000 上通常是用户正在开服的进程，**不要动它**。测试用 `.claude/launch.json` 里的 `stronghold-dev`（3005，控制台在 3105）。控制台演示可以不开游戏服：用 `test/match/harness.js` 跑一局，再对一个假 lobby（`{ rooms, onMatchEnd() {}, safeData }`）调 `startAdmin({ port: 3106, resultsDir, settingsFile })`，把这两个路径指到临时目录，别写进仓库的 `logs/`。

## 2. 已完成

| 期 | 内容 |
|---|---|
| 第一期 | 回到上个休整期开始；加金币、改 LP、商店等级、免费刷新、发放干员和道具 |
| 第二期 | 每个休整期存档、选回合回档；盟约层数和人数加成；托管；效果和机变卡；棋盘编辑；敌人预览；战斗判胜判负；计时倍率 |
| 第三期 | 本局统计（曲线、每回合详情、累计数据、干员排行）、上一局统计、操作日志；对局记录（自动保存 + 查看页）；敌人日程（全部组合、概率、实际出怪、任一回合指定）；休整期时长设置（全局、持久化） |

用户明确说「别的暂时不用」：商店指定格子、存档导出与恢复都不做。

## 3. 候选的下一步（用户还没选）

第三期结束时提给用户的扩充方向，按价值排序。用户还没挑，做之前先确认。

1. **每回合阵容快照**：在 `recordRound` 里记下作战区的干员、精锐、装备（`boardOrder(ps.board)`，名字用 `ps.gd`，参照 `admin.js` 的 `playerDetail`），每回合详情里显示。
2. **漏怪分析**：`lastResults.get(pid).leaked` 每条带 `enemyKey`，按敌人汇总每回合漏了哪些、各几只，配合 `history[].enemy`。
3. **跨局汇总**：「对局记录」页加总览，读 `logs/results/*.json`：胜率、按难度的平均通过回合、最常用的干员和盟约、伤害最高的干员。只读文件，不碰对局逻辑。
4. **每回合经济明细**：`ps.round`（`refreshes / buys / sells / spent`）在回合开始时清零，要在 `settle()` 时（清零之前）记下来。
5. **盟约层数曲线**：`ps.layers` 和 `ps.bonds[id].active`，曲线多一个指标或单独一张图。
6. **导出 CSV**：每回合数据和累计数据，`/api/result?id=&format=csv` 或页面上生成下载。

## 4. 附：第二期各项的实现要点

以下是第二期时读代码确认过的接口，第三期的实现见 LOCAL-DEV.md 第 5 节。行号是当时的，改过代码后以函数名为准。4.6 的「重新随机」已换成敌人日程，4.8、4.9 已按其中的要点完成（结算记录在控制台里自己画，没有复用游戏的 ResultScreen）。


### 4.1 每回合存档

**已完成（2026-10-04）**：下列内容已实现并通过 `rewind.test.js`、`admin.test.js`。

- 现在是 `m.prepSnapshot`（单个）。改成 `m.prepSnapshots: Map<round, snap>`，`capturePrep` 写入 `m.round` 那一格；`rewindToPrep(m, round)` 取对应那份。
- 回到第 R 回合后，删掉 `> R` 的存档（那条时间线作废）。R 自己那份会被随后的 `enterPrep()` 重新写入。
- 实测成本：第 12 回合、1 真人 + 3 AI，快照 JSON 约 25 KB，一次 `structuredClone` 约 2.3 ms。一局最多 15 份，可以全留。
- `refs` 里的 `bossPool` 按引用保存是安全的：它只在 `startFinalAssault` 里新建，休整期时要么是 null，要么是上一场已经打完的那个。改的时候别破坏这个前提。
- 快照在机变（SP_DRAFT）之后才拍，回到某回合会保留那回合已选的机变卡。用户没要求重选机变，保持现状。
- 控制台：回档按钮改成「回到第 [下拉] 回合休整期」。`matchView` 里 `rewindRound` 改成 `rewindRounds: number[]`。
- 测试：在 rewind.test.js 加一个用例「从第 6 回合回到第 3 回合后重打 ≡ 直打」，同时断言第 4–6 回合的存档已被删掉。

### 4.2 盟约

- 层数在 `ps.layers[bondId]`，上限 `BOND_LAYER_CAP = 999`（`shared/constants.js`，用 `layerGainRoom(before, n)` 截断）。
- **增加（走游戏逻辑）**：`ps.addLayers(bondId, n, { reason: 'admin' })`（`PlayerState.js` 约 807 行）。它会 `recompute()` 并派发 `onLayers`，等同正常获得。只能加，不能减。
- **直接设定**：`ps.layers[bondId] = n`（0–999），然后 `ps.recompute()`。不派发任何效果。
- 人数加成：`ps.bondCountBonus[bondId] = n`，然后 `ps.recompute()`（effectsMeta.js 的 `setBondCountBonus` 就是这么写的）。层数只在盟约激活时生效，人数加成可以强行激活。
- 盟约列表：`m.gd.bondIds`，名字 `m.gd.bond(id).name`，激活门槛 `gd.bond(id).thresholds`（如炎 `[3, 6, 9]`）。当前状态读 `ps.bonds[id]`：`{ count, active, tier, layers }`。
- 控制台：每个玩家展开一个盟约表（名字、人数/门槛、层数、加成），三个操作 `bondAdd`、`bondSet`、`bondBonus`。

### 4.3 托管切换

- `m.setAutoplay(ps, on)`（`Match.js` 约 1006 行），开启时内部会 `kickBot(ps)` 让 AI 接手当前阶段。只对真人有意义，AI 座位跳过。
- 玩家能看到自己被托管：`m.public.players[].autoplay` 已经存在，客户端会显示。

### 4.4 效果和机变卡

- 列表：`ps.effects`，每项 `{ id, key, name, desc, iconKind, counter?, battle?, params?, data? }`；`ps.bounties`（悬赏）。
- 删除：`ps.effects.splice(i, 1); ps.dirty();`，与 `effectsMeta.js` 的 `removeEffect` 一致。
- 补发机变卡：`applyCard(m, ps, card)`（`choices.js`，Match 里通过 `m._applyCard` 调用）。卡片来源 `m.gd.choices.cards.tactic`（43 张）和 `.bounty`（129 张）；战术卡要先 `tacticCard(c)` 转成卡片对象。悬赏卡用 `m.addBounty(ps, card)`。
- 注意 `card.team` 为真的战术卡会同时作用到所有队友（`applyCard` 内部处理）。界面上要提示。

### 4.5 棋盘

- `ps.board` 是 `Map<"r,c", piece>`（`tileKey` 在 `server/match/board.js`）。合法区域 `GEO.FIELD = { r0: 9, r1: 12, c0: 2, c1: 10 }`。手牌 `ps.hand`（10 格）、整备区 `ps.temp`（5 格）。棋子 `{ uid, kind: 'chess'|'item'|'token', id, items, poolCopies, ... }`。
- 定位：`ps.find(uid)` → `{ piece, area, idx?, key?, holder? }`。
- 删除干员：参照 `sell()` 的顺序，但不给钱：`_detach(loc)` → `removeTokensOf(uid)` → 装备 `stow` 回手牌 → `returnCopies(piece)` → `checkItemMerges()` → `recompute()`。
- 升为精锐：`ps.promote(piece)`（会从卡池补拷贝）。
- 装道具：`equip()` 带 `_gate()`，非休整期或已就绪会被拒。控制台要无视阶段的话，直接用 `ps._attach(target, item)` + 派发 `onEquip`，参照 `equip()` 里非消耗品的那条分支。
- 显示：表格或 4×9 小网格（行 9–12、列 2–10），每格显示干员名和精锐标记即可，不需要画图。

### 4.6 敌人预览

- 每个玩家下一场的敌人：`m.nextEnemiesFor(ps)` → `[{ enemyKey, count, gate, t, fly, elite, boss, source }]`，名字 `m.gd.enemy(key).name`。
- 普通回合的波次在 `startRound` 里用 `buildNormalWave(gd, m.rngWaves, m.factions, r)` 生成，存在 `m.wave`；boss 回合是 `m._planBossWaves()` → `m.bossWaves`。
- **实现时发现**：每回合的敌人条目在开局时就由日程定死了，直接重新调用 `buildNormalWave` 得到的是同一批敌人，也不消耗 `rngWaves`。实际做法是用 `pickRoundEntry` 在同一阵营类型里重抽，见 LOCAL-DEV.md 第 5 节。
- （2026-10-08 起「重新随机」已换成「敌人日程」，见 LOCAL-DEV.md 第 5 节。下面是原来的做法。）「重新随机」：只允许在 ROUND_START / SP_DRAFT / PREP（战斗开始前）。重新调用上面的函数会多消耗一次 `rngWaves`，之后的随机流跟着变。这是预期行为，回档能恢复。改完要 `markPublic()` 并给每人 `dirty()`（预览在 `m.private.nextEnemies` 里）。

### 4.7 战斗干预

- 默认客户端战斗：战场在 `m.fields`，每个 `f` 有 `cc: true`、`battleId`、`players`、`mode`、`done`。
- **判本场胜**：`f.result = syntheticResult(f.players)`（`fields.js`，空漏怪 = 完美）→ 给显示该战场的真人发 `{ t: 'b.end', battleId, fieldId, reason: 'forced' }`（`m._humansShowing(f)`，参照 `_endFinal`）→ `m._fieldDone(f)`。全部战场完成后会自动进入结算。
- **判本场负**：同上，但 `perPlayer[pid].leaked` 填若干条 `{ enemyKey, counted: true }`。结算扣血 = `min(lpCapPerRound(10), 计数漏怪数)`，见 `settle()`。
- boss 战（FINAL_ASSAULT / HIDDEN_CORE）：设 `m.bossPool.hp = 0` 后调 `m._checkFinalEnd()`，或设 `m.teamLp = 0` 判负。
- 服务器托管的战场（`f.mode === 'server'`）可能还有 `f.job` 在跑，先 `m._clearFieldTimers(f)`。
- 计时倍率：`m.timerScale`，`m.scaled(ms)` 读它。已经设好的倒计时不会重算，只影响之后的计时。
- 测试：用 harness 的 `clientCombat: true` 跑到 COMBAT，强制判胜，断言进入 SETTLE 且 LP 不变；判负断言 LP 扣了 `min(10, n)`。

### 4.8 数据记录与曲线

- 记录点：`settle()` 末尾（结算后 LP 已扣），每回合每个玩家记 `{ round, lp, funds, level, layers }`，存到 `m.history`（数组，在构造函数里初始化）。把 `history` 加进 `rewind.js` 的 `MATCH_KEYS`：回档时历史会自动恢复成那个休整期时的样子，和存档的截断规则一致，不用另写代码。
- 控制台操作日志：`handleAction` 里已经 `log.info`，另外存一份到 `room` 或 `match` 上的数组（最近 100 条），页面上显示。
- **图表**（按 dataviz 规范，已跑过校验）：
  - LP 和金币分成两张图，不要双 Y 轴。
  - 系列颜色固定按座位顺序，不随排名变：`#3987e5`、`#d95926`、`#199e70`、`#c98500`。已对控制台面板底色 `#141816` 跑过 `validate_palette.js --mode dark`：全部通过，最差相邻 CVD ΔE 8.4、常规视觉 ΔE 19.8、对比度都 ≥ 3:1。
  - 线宽 2px，数据点 ≥ 8px；网格线用 `#2c2c2a`、轴用 `#383835`、标签用 `#898781`；文字一律用正文颜色，不用系列色。
  - ≥ 2 个系列时必须有图例，并在线尾直接标玩家名；悬停时竖线对齐到回合，一个提示框列出所有玩家在该回合的值（数值在前、名字在后，名字用 `textContent` 插入）。
  - 提供一个「表格」切换，列出同样的数据，保证不用悬停也能读到。
  - 做完截图检查标签是否重叠。

### 4.9 保存对局结算记录

- 结算数据就是 `m.result` 帧：`buildResult(m, outcome)`（`server/match/results.js`），对局结束时存在 `m.lastResultMsg`；lobby 的 `onMatchEnd(room, ctx, summary)` 收到的 `summary` 是去掉 `t` 后的同一份数据，另加 `errors`。
- 保存：在 `onMatchEnd`（或 `Match.finish` 之后）写 `logs/results/<时间>-<房间码>.json`。`logs/` 已在 `.gitignore` 里。建议同时存当时的 `m.public` 一份，客户端的 `normalizeResult(res, pub)` 会用它补齐字段。
- 显示「和游戏里一样的统计页」：游戏端是 `public/js/screens/result.js` 的 `ResultScreen`，从 store 读 `match.result` 和 `match.public`。**还没决定怎么复用**，建议做法如下（未验证）：
  - 控制台服务器（127.0.0.1）挂载一份只读的 `public/`：`server/index.js` 导出了 `createStaticHandler`，可以直接用。
  - 加一个查看页，`store.set({ match: { ...emptyMatch(), result, public: pub } })` 后渲染 `ResultScreen`，需要引入 `/css/theme.css`、`/css/components.css`、`/css/screens/result.css` 和 importmap。
  - 这样记录只在本机可见，不会通过隧道暴露。
  - 不要把记录放到游戏服务器的公开路径下：游戏端口通过隧道对公网开放，而且没有鉴权。
- 控制台加一个「对局记录」列表：时间、房间、模式难度、胜负、回合数，点开看统计页。

## 5. 做法约定

- 每个新操作都加进 `admin.js` 的 `PLAYER_ACTIONS` / `MATCH_ACTIONS`，在 `m.guard()` 里执行，返回 `OK` 或 `{ error }`。
- 改了状态：`ps.dirty()` / `m.markPublic()`；影响羁绊或棋盘：`ps.recompute()`。
- 对局逻辑里不要用 `Math.random` / `Date.now`。
- 给 `Match` 加回合内会变的字段，同步更新 `rewind.js` 的 `MATCH_KEYS`，跑 `node --test test/match/rewind.test.js`。
- 新操作在 `test/admin.test.js` 里至少各测一次。全量 `node --test` 约 10 分钟，一次只开一份。
- 改完用 3005 的预览（或第 1 节说的演示控制台）实际打开控制台看一遍，再告诉用户。
- 控制台的数据、记录和设置只走 127.0.0.1 的控制台端口；不要在游戏端口上加入口（它通过隧道对公网开放，没有鉴权）。
- 回复用中文，结论先行；没验证的说没验证。
