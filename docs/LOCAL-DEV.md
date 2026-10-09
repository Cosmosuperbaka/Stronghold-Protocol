# 本地开发笔记（私有分支）

这份文档记录本仓库在上游 [sganggs/Stronghold-Protocol](https://github.com/sganggs/Stronghold-Protocol) 之上做的改动，以及读代码时摸清的结构和坑，方便之后继续开发。上游自己的架构文档见 [DESIGN.md](DESIGN.md)（总体）、[META.md](META.md)（对局与经济）、[SIM.md](SIM.md)（战斗模拟）。

## 1. 仓库与分支

| 远程 | 地址 | 用途 |
|---|---|---|
| `origin` | `zhewang448/Stronghold-Protocol`（私有） | 自己的改动推到这里 |
| `upstream` | `sganggs/Stronghold-Protocol` | 拉官方更新 |

- 工作分支 `local-tools`，私有仓库的默认分支也是它。`master` 只跟踪上游，不在上面改。
- 合并上游大版本时可以先开临时分支（如 v0.2.1 时的 `local-tools-v0.2.1`），测完快进回 `local-tools` 再删掉。
- 同步上游：`git fetch upstream` → `git merge upstream/master` → `npm install` → `npm run setup`（上游常会加素材）→ `node --test`。
- 素材 `public/assets/`、`.cache/`、`.claude/` 都在 `.gitignore` 里，不进仓库。新机器 clone 后要先 `npm install && npm run setup`。

## 2. 本地新增了什么

本地自己的文件（上游没有，合并不会冲突）：

| 文件 | 作用 |
|---|---|
| `scripts/start-tunnel.bat` / `.mjs` | 一键开服 + cloudflared 公网隧道，列出地址，持续输出日志。详见 [scripts/README.md](../scripts/README.md) |
| `scripts/stop-server.bat` / `free-port.mjs` | 释放游戏端口（结束服务器和指向它的隧道），仅 Windows |
| `server/admin.js` / `admin.html` | 本机主机控制台（HTTP API + 单页界面） |
| `server/match/rewind.js` | 回到任一回合的休整期开始（快照 + 恢复） |
| `server/match/history.js` | 每回合记录 `m.history`（控制台的曲线、每回合详情、干员排行、对局记录） |
| `server/match/enemyPicks.js` | 敌人日程：每回合所有组合、本局抽到的概率、实际出怪、主机指定（`m.adminPicks`） |
| `server/match/hostSettings.js` | 主机设置（目前是休整期时长），对所有房间、所有对局生效 |
| `server/match/adminDiy.js` | 控制台「发放自选」：给任一玩家（含 AI）发放任一有 kit 的自选干员 |
| `test/match/rewind.test.js`、`test/admin.test.js` | 对应的测试 |
| `docs/LOCAL-DEV.md`、`LOCAL-CHANGELOG.md`、`HANDOFF.md` | 本分支的文档（上游的 `CHANGELOG.md` 不改，避免合并时冲突） |

改动过的上游文件（合并上游时可能冲突，每处都只有几行）：

| 文件 | 改了什么 |
|---|---|
| `server/sim/rng.js` | 加了 `rng.setState()`，回档用 |
| `server/match/Match.js` | 构造函数里加了 `prepSnapshots`（`Map<回合, 快照>`）、`history`、`adminPicks` |
| `server/match/match/prep.js` | `enterPrep()` 开头调用 `capturePrep()`；休整期倒计时改读 `prepSeconds(this, gd.prepTime(r))` |
| `server/match/match/settle.js` | `settle()` 结尾和 `finish()` 里调用 `recordRound()` |
| `server/match/match/phases.js`、`bossRounds.js` | 生成波次的三处（`startRound`、`_planBossWaves`、领袖战开打）把 `this.factions` 换成 `waveSource(this)` |
| `server/match/audit.js` | 休整期倒计时的检查改用 `prepSeconds()` |
| `server/http/boot.js` | `runMain()` 里启动控制台，打印 `Console:` 地址 |
| `tools/build-data.mjs` | 加了 `DIY_COLLAB_ALLOWED`：列在里面的联动 6★ 不受两条联动排除规则限制，进自选池（见第 8 节） |
| `server/sim/content/kits/index.js` | `OPERATOR_KIT_FILES` 末尾加了 7 个联动 kit（`op-ash.js` … `op-makoto.js`） |
| `server/sim/ai.js` | `attack` hook 多带一个 `attackId`（两处 `b.emit('attack', …)`），丰川祥子的音符要用 |
| `server/sim/battle/combat.js` | 加了 `nextAttackId()`：丰川祥子没有目标时的「持续攻击」自己领一个攻击编号 |
| `server/sim/content/traitMods.js` | 加了 `KIT_OWNED_CHARS`（丰川祥子）：她的 LOR-Y 和 REA-Y 句式相同，但只算技能未开启时的范围，由她的 kit 处理；不排除的话引擎会再加一次攻速 |
| `tools/assets/plan.mjs` | 中文语音树：只有联动配音（`voiceLangDict` 没有 `CN_MANDARIN`、有 `LINKAGE`）的干员改用 `voice/` 目录（灰烬、艾拉、玛露西尔、丰川祥子、结城理） |
| `public/js/render/fx/kinds.js` | `FX_KINDS` 加了 `persona`（结城理换人格，只换模型）、`oblvnsNote`（丰川祥子音符命中） |
| `public/js/render/units.js` | `FORMS` 加了 `char_4217_makoto`：结城理各人格的动画 |
| 生成的数据 | `data/backups.json`、`data/assets.json`、`data/i18n/*.json`、`test/golden/diy.json`：合并上游时按第 8 节重新生成，不要手工合 |
| 测试里写死的数量 | `test/backups.test.js`、`diy.test.js`、`assets-diy.test.js`、`full-potential.test.js`、`potential.test.js`、`i18n-data.test.js`、`feedback7-voices.test.js`、`content/feedback5-we2-summon-hand.test.js`、`render/issue25-downback.test.js`：自选池 71 → 78、单位形态 256 → 277、有语音的干员 191 → 198 等，改动处都标了 `local-tools` |

上游自己的文档（`docs/DATA.md`、`ASSETS.md` 等）里「71 名、7 名联动被排除」的说法没改，避免合并冲突，以本节为准。

0.2.0 起上游把 `Match` 的方法拆到了 `server/match/match/*.js`，启动代码从 `server/index.js` 拆到了 `server/http/`。

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
| `connected` / `left` / `autoplay` / `loadout` / `ops` | 连接状态以现在为准，配装和潜能 / 练度（0.2.2 的 `ops`）在开局后就锁定 |

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

页面顶部三个标签：

- **房间**：每个房间一张卡片，含对局操作、玩家表和「详情」，下面是可折叠的统计面板：本局统计（对局结束后变成「上一局统计」）、敌人日程（剧透，默认折叠）、控制台操作日志。
- **对局记录**：`logs/results/` 里保存的每一局，点开看结算详情。
- **设置**：休整期时长，对所有房间、所有对局生效。

### 安全

三层，缺一不可：只监听 127.0.0.1（局域网和隧道都到不了）；`/api/*` 必须带 `X-Admin-Token`（每次启动随机生成，嵌在页面里）；`Host` 头必须是控制台自己的 localhost 地址（防止浏览器里打开的其他网站通过 DNS rebinding 调用）。`test/admin.test.js` 覆盖了这三条。对局记录和设置也只走这个端口，游戏端口（会通过隧道公开、没有鉴权）上没有任何入口。

### API

| 请求 | 说明 |
|---|---|
| `GET /` | 控制台页面 |
| `GET /api/rooms` | 所有房间：对局阶段、玩家数据、`history`、`enemyPlan`；房间级的 `log`（操作日志）和 `lastMatch`（没有进行中的对局时，上一局的统计） |
| `GET /api/catalog?room=` | 当前模式可发放的干员、道具、机变卡 |
| `POST /api/action` | `{ room, action, playerId?, value? }` → `{ ok }` 或 `{ error }` |
| `GET /api/results` | 对局记录列表（新的在前，只有摘要） |
| `GET /api/result?id=` | 一条记录全文。`id` 必须是 `logs/results/` 里的文件名（`^[\w-]+\.json$`），防路径穿越 |
| `GET /api/settings` | 当前的休整期设置 `{ prep }`、设置文件路径，以及各同盟模式每回合的默认秒数 |
| `POST /api/settings` | `{ prep }`：校验、写文件，然后生效 |

对局操作：`rewind`（`value` 为回合数，空则最新）、`endPrep`、`pause`（仅独立模拟）、`endMatch`、`enemyPick`（`{ round, id }`，指定某回合的敌人组合，`id` 为空恢复原定）、`battleWin` / `battleLose`（`{ field, n? }`，仅客户端战斗）、`timerScale`（0.1–10）。

玩家操作：`funds`（增减）、`lp`（设定）、`level`（设定）、`refresh`（+1 免费刷新）、`chess` / `item`（发放）、`diy`（`{ charId, tier: 5|6, elite, skillIndex?, uniEquipId? }`，发放自选，见下）、`diySkill`（同样的值，只改技能和模组）、`bondAdd` / `bondSet` / `bondBonus`（`{ bond, n }`）、`autoplay`（1/0，仅真人）、`effectRemove` / `bountyRemove`（效果 / 悬赏 id）、`card`（机变卡 effectId）、`pieceRemove` / `piecePromote`（棋子 uid）、`pieceEquip`（`{ target, item }`）。房间操作：`closeRoom`。

- **会触发游戏效果的**：`bondAdd`（走 `addLayers`，派发 `onLayers`）、`card`（走 `applyCard`，全队卡会作用到所有存活队友）、`pieceEquip`（派发 `onEquip`，能合成时直接合成）。其余都是直接改数据，不扣金币、不触发 `onLevelUp` 之类的效果。
- **判负**：普通战场按 `n` 条计数漏怪生成结果，结算扣 `min(10, n)`；同盟模式下这些漏怪会像真的一样进入联防。联防判胜等于全部击杀，判负等于没人支援（按漏怪者自己的漏怪数扣血）。领袖战判胜把共享血池清零，判负把同盟 LP 清零，两者都会结束所有领袖战场。

### 统计与记录

- **每回合记录**：`history.js` 的 `recordRound(m)` 在 `settle()` 结尾写一条 `{ round, enemy, players: [...] }`。`enemy` 是这回合的敌人组合（类型、特殊 / 普通 / 精英的名字、是否控制台指定）。每个玩家有 LP、剩余金币、商店等级、累计花费 / 伤害 / 漏怪 / 击杀，以及本回合的扣血、漏怪、击杀、伤害、是否无伤、每个造成伤害的干员（来自 `lastResults` 的 `unitStats`，召唤物不算）。领袖战回合不经过 `settle()`，由 `finish()` 补记。`history` 在 `MATCH_KEYS` 里，回档时自动截断，被放弃的回合不保留。
- **伤害的含义**：模拟器记的是实际从敌人身上扣掉的生命值（减防、减抗、护盾之后，不算溢出，`server/sim/damage.js` 的 `applyHpLoss`）。同一波怪全部击杀时，几个玩家的伤害基本相同，等于这波怪的总血量；差别来自漏怪、悬赏怪、敌人回血或召唤。元素损伤不扣血，不计入。联防里的伤害只进累计数，不分干员。游戏结算页的「造成伤害」是同一个数。
- **累计数据**：直接读 `ps.stats`（`statsOf()`），实时。`gold` 是花掉的金币，`fundsGained` 含利息、悬赏和控制台加的。
- **操作日志**：`handleAction` 每次执行后写进 `room.adminLog`（最多 100 条，失败的也记，`closeRoom` 不记），跨对局保留到房间关闭。
- **对局记录**：`startAdmin` 包装了 `lobby.onMatchEnd`（`onEnd` 闭包按属性名调用它，所以实例上的包装会生效；这样不用改上游的 `lobby.js`），在原函数清掉 `room.match` 之前写 `logs/results/<时间>-<房间>.json`：`{ savedAt, room, mode, difficulty, result, history }`。`result` 是 `buildResult` 的结算数据，阵容、道具、盟约、分队补上了名字，`stats` 合并了 `statsOf()`。写文件失败只记日志，不影响对局。同一份数据精简后存在 `room.adminLastMatch`，房间卡片据此显示「上一局统计」，下一局开始后换回本局。`startAdmin({ resultsDir })` 可以改目录（测试用临时目录）；`SP_ADMIN=0` 时不存记录。
- **每回合干员伤害排行**：前端从 `history[].players[].units` 直接算（`drawUnitRounds`），不另存数据。「占本人」的分母是该玩家这回合所有干员伤害之和，不含联防。
- **页面**：统计面板在 1.5 秒一次的重绘之外单独维护（`statsPanel`）：重绘后把原节点移回房间卡片，各部分只在自己的数据变化时重画，所以悬停提示、下拉框和展开状态不会被轮询打断。曲线一次画一个指标（不做双 Y 轴），可切换成表格；颜色按座位固定（`#3987e5 #d95926 #199e70 #c98500`，对 `#141816` 和详情底色 `#101311` 都跑过 dataviz 校验）。

### 发放自选（adminDiy.js）

自选棋子是按「自选位」区分的（每人 4 个：5 阶、6 阶各 2 个），客户端和战斗都按自选位读玩家的选择（`ps.diy`、`m.private.diy`）。所以发放某名自选干员时，先把它放进该等阶的一个自选位，再发这个位的棋子：优先用已经放着它的位，其次空位，再次这名玩家场上、手牌、整备区都没有棋子的位。也就是说，同一时间每个等阶最多 2 名不同的自选干员；有棋子的位不会被换掉（换掉的话那些棋子会跟着变成别人）。一名持有干员只能占一个位（和自选编队规则一致），已经在另一等阶上场时会拒绝。

- 技能和模组：控制台的两个下拉框，不选就用默认（最后一个技能、第一个可用模组，同干员调配）。`uniEquipId: 'none'` 是不装备。原型干员固定用锁定的选择，下拉框不可用。
- 一个自选位只有一套技能和模组，同一位上的棋子都一样。所以给已在位上的干员换技能（发放时选了别的技能，或点「改技能」走 `diySkill`），这个位上已有的棋子会一起变。召唤物跟技能走的干员（召唤物在手牌里）换技能后没专门处理，可能不一致。
- 新位的库存直接给满，不检查本局禁用盟约（控制台不受限制）。
- AI 座位也可以发，绕过 `setDiy` 的 AI 检查，照它的写法重建 `ps.diy`、`ps._diyRecords`、`ps.gd`。
- 回档：自选位的分配不回滚（`diy` 等在 `PS_SKIP` 里）；快照之后才加的位，库存会被恢复掉，之后那个位从商店抽不到，直到下次发放。
- 「发放干员」框里填了没分配的自选位 id 会提示改用「发放自选」。

### 敌人日程（enemyPicks.js）

开局时 `setupMatchWaves` 定下整局的日程：从 6 个随机类型（飞行、频次、元素、持续、隐匿、折射）里取 3 个，每个占 3 个回合，「特异」占剩下的 6 个，打乱后每回合一个类型；再给每回合按权重抽一个「该类型 × 前半（1–7 回合）/后半」的条目，排除本模式禁用的。每个条目带 1 种普通、1 种精英，所以一个条目就是一种组合（数据里共 67 个）。

- `planView` 列出每回合所在半场的**全部**组合，标出是否本模式禁用、本局有没有这个类型，并按日程算出官方抽到每个组合的概率（类型下没有可用条目时回落到特异，和 `pickRoundEntry` 一致）。
- `rosterOf` 按该回合的出怪模板算出实际出怪（不含悬赏）：第 1–3 回合的模板没有特殊位，地面组合去掉飞行位、飞行组合去掉地面位，领袖回合只出精英护卫。所以组合里的怪不一定都会出现。
- 主机指定存在 `m.adminPicks`（在 `MATCH_KEYS` 里，回档恢复）。生成波次的三处（`startRound`、`_planBossWaves`、领袖战开打）通过 `waveSource(m)` 读日程。当前回合只能在战斗开始前改，改完立即重建波次（玩家的敌人预览跟着变）；之后的回合在那回合开始时生效。指定的组合不消耗 `rngWaves`，其他随机流不变。

### 休整期设置（hostSettings.js）

进程级的一份 `prep`：`default`（按数据 `rounds[r].prepTime`，同盟第 1 回合 65 秒到第 14 回合 195 秒）、`scale`（× 0.1–10）、`fixed`（每回合 5–3600 秒）、`perRound`（指定的回合用指定秒数，其余按数据）、`untimed`（不限时，等所有人就绪或控制台结束）。

- `enterPrep()` 设倒计时时经过 `prepSeconds()`，所以进行中的对局从下一个休整期开始生效；房间的计时倍率 `timerScale` 再乘一次。`audit.js` 的倒计时检查用同一个函数。
- `soloUntimed` 的对局（独立模拟、只有一个真人的同盟房间）仍然不限时。
- `startAdmin` 启动时读 `logs/admin-settings.json`（`settingsFile` 选项可改，测试用临时文件）。保存时先校验、写临时文件再改名，最后才生效；文件损坏时记日志并按默认处理。
- 设置不进回档快照：回档重进休整期时用的是当前设置。`SP_ADMIN=0` 时控制台不启动，设置也不会加载。

### 本地文件

都在 `logs/` 下（已在 `.gitignore` 里，不会提交）：

| 路径 | 内容 |
|---|---|
| `logs/results/<YYYYMMDD-HHMMSS>-<房间>.json` | 每局一份对局记录，同一秒同一房间重名时加 `-2`、`-3` |
| `logs/admin-settings.json` | 休整期设置 |

### 加一个新操作

在 `admin.js` 的 `PLAYER_ACTIONS` 或 `MATCH_ACTIONS` 表里加一项，签名分别是 `(m, ps, value)` 和 `(m, value)`，返回 `OK` 或 `{ error }`。它会在 `m.guard()` 里执行，所以异常会被隔离并记日志，结束后自动推送视图，也会自动进操作日志（在 `admin.html` 的 `ACTION_NAMES` 里给它一个中文名）。直接改字段后记得 `ps.dirty()`，影响羁绊或棋盘合法性的改动还要 `ps.recompute()`。页面上的按钮或输入框在 `admin.html` 的 `roomCard` / `playerRow` 里加，用 `data-click` 或 `data-act` 属性接到同一个 `act()` 函数。需要「像玩家一样操作」时，改成调用 `ps.levelUp()` 这类方法即可。

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
- **合并上游时**先看第 2 节「改动过的上游文件」：冲突只会出在那几处。合并后跑 `node --test test/match/rewind.test.js test/admin.test.js`；如果上游改了生成波次或休整期计时的写法，要把 `waveSource(this)`、`prepSeconds(...)` 接到新位置。
- **setup 下载很慢或大量 err**：本机 Node 22.14 的 `fetch()` 不走 `HTTP(S)_PROXY`（日志会提示，需要 Node ≥ 22.21 加 `NODE_USE_ENV_PROXY=1`），所以是直连 GitHub，速度取决于本机代理设置。临时可以用 `node tools/setup.mjs --asset-source=mirror`（第三方镜像 gh-proxy.com）。下载可续传，中断后重跑会跳过已有文件。
- **合并上游后**要重新 `npm run setup`，上游会新增素材清单，否则素材测试会多出一批失败。setup 和 `npm install` 会改写 `data/assets.json`、`package-lock.json`，合并时用上游的版本（`git checkout -- data/assets.json package-lock.json`）。

## 8. 联动干员进自选池

上游以版权为由把联动 6★ 排除在自选池外（`tools/build-data.mjs` 的 `DIY_EXCLUDED_TEAMS` 按阵营、`DIY_EXCLUDED_NUMBER_PREFIXES` 按编号前缀）。本分支的决定（2026-10-09）是把联动干员放进来：charId 列在同一文件里的 `DIY_COLLAB_ALLOWED`，再按下面的步骤重新生成。现在 7 名全部加入，自选池 71 → 78。

### 已加入

7 名的 kit 都取自 BBleae 的 fork（`BBleae/Stronghold-Protocol`，提交 `64866e81`，2026-10-08，GPL-3.0，和上游同许可证）。那边按上游 kit 规范写，带每名一个 `test/content/op_<代号>.test.js`，设计说明在它的 `docs/design/fork.md` §F6（每名做了什么、哪些是 [ASSUMED]）。本地 fetch 在 `refs/bbleae/*`。

| 干员 | kit | 盟约 |
|---|---|---|
| 灰烬 `char_456_ash`（RS01） | `op-ash.js` | 协防 |
| 麒麟R夜刀 `char_1029_yato2`（MH02） | `op-yato2.js` | 协防 |
| 焰狐龙梓兰 `char_1048_orchd2`（MH05） | `op-orchd2.js` | 协防 |
| 艾拉 `char_4123_ela`（RS05） | `op-ela.js`，召唤物雷鸣地雷 `token_10033_ela_grzmot`（手牌 4） | 协防 |
| 玛露西尔 `char_4141_marcil`（DD02） | `op-marcil.js` | 协防 |
| 丰川祥子 `char_4182_oblvns`（AM01） | `op-oblvns.js` | 协防 |
| 结城理 `char_4217_makoto`（PS33） | `op-makoto.js` | 拉特兰（隐藏势力） |

那个 fork 基于 0.2.1，搬过来时改了这些：
- `Math.hypot` / `sin` / `cos` 换成 `server/sim/detmath.js` 的版本（0.2.2 起 sim 里禁用，`test/sim/detmath.test.js` 会扫）：灰烬、丰川祥子。
- 玛露西尔用到 fork 独有的 `server/sim/content/fxtiles.js` 的 `keyTiles`（只是 fx 的格子列表），内联进了 `op-marcil.js`。
- 丰川祥子的 LOR-Y：0.2.2 的 `traitMods.js` 会给所有「攻击范围内存在N名及以上敌人时攻击速度+X」自动加攻速，她的 kit 自己也加（只算技能未开启时的范围），会算两次。在 `traitMods.js` 里按 charId 排除了她（`KIT_OWNED_CHARS`）。
- 焰狐龙梓兰换成了 fork 的版本（他们修过 S1/S2/S3 的时序和箭的偏移），替掉了原先取回的上游 feedback5 版本；原来本地加的 fx `dragonArrow` 不再用到，删了。
- 联动干员大多只有联动配音（`LINKAGE`），镜像上没有 `voice_cn/`，中文语音树改用 `voice/` 下的同名文件（`tools/assets/plan.mjs`）。所以这 5 名的中文、日文语音是同一套。
- fork 的 `TOKEN_SKIN_SPINES`（艾拉地雷的皮肤模型）上游没有，没搬：雷鸣地雷没有 Spine，只有头像。

`test/ui/diy-collab.e2e.test.js`（fork 的浏览器测试：选人、商店、部署、战斗里结城理的人格模型）也搬了。本机没有 Chrome，用 Edge 跑：`CHROME_PATH="C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" SP_E2E=1 node --test test/ui/diy-collab.e2e.test.js`。

fork 文档里列的未完成项（§F6.4）：Fever 槽、她的粉色技力条和 KiLLKiSS BGM 切换没画，音符的飞行没画；龙之箭没有自己的飞行图形；艾拉地雷没有模型。

### 加一名（或合并上游后）重新生成

1. **游戏数据**：`.cache/gamedata` 要和上游构建 `data/` 时用的 ArknightsGameData 版本一致，否则别的干员的数字也会变。0.2.2 用的是 `a550f5e`（2026-09-29，Client 2.7.71）。判断办法：先不改代码，在临时目录跑 `node tools/build-data.mjs --offline --out <临时目录>`，和 `data/` 逐字节相同才对。不对就用 curl 按 `.cache/gamedata` 里现有的文件列表，从 `https://raw.githubusercontent.com/Kengxxiao/ArknightsGameData/<commit>/zh_CN/gamedata/<路径>` 重新下载（Node 不走代理，curl 会走）。
2. `node tools/build-data.mjs --offline`：改写 `data/backups.json`。
3. `node tools/fetch-assets.mjs --add-only`：下载新干员的美术和语音，并改写 `data/assets.json`。网络不稳时可以重跑，会续传。
4. 数据翻译：`node tools/build-i18n.mjs`（en），以及 `--lang ja` / `ko` / `zh-TW`。下载失败就用 curl 把表预先放进 `.cache/gamedata-<lang>/`（`excel/` 下 8 张表，加上 `levels/enemydata/enemy_database.json`），再加 `--offline`。和旧文件做 JSON 比较：差异应该只有新干员、`_h` 和 `meta` 的覆盖率。2026-10-09 的 zh-TW 还顺带补上了怒潮凛冬的译名（源数据比上游构建时更新）。
5. kit 文件加进 `kits/index.js` 的 `OPERATOR_KIT_FILES` 末尾；跑 `npm run golden:update`，应该只有 `test/golden/diy.json` 变。
6. 改测试里写死的数量（第 2 节的表），然后跑 `node --test test/backups.test.js test/diy.test.js test/assets-diy.test.js test/full-potential.test.js test/potential.test.js "test/i18n*.test.js" test/data.test.js test/golden.test.js test/content/op_<代号>.test.js`。

### 合并上游时

`data/backups.json`、`assets.json`、`i18n/*.json`、`test/golden/diy.json` 都是生成的：冲突时先取上游版本，再按上面的 1–5 步重新生成。第 7 节说的「`data/assets.json` 用上游的版本」在这里不适用：直接用上游版本会丢掉联动干员的素材条目，要再跑一次第 3 步。

EN / JA / KO 客户端里没有焰狐龙梓兰和结城理，zh-TW 里还没有麒麟R夜刀，这些在对应界面显示中文。`test/i18n-data.test.js` 的天赋覆盖率门槛因此从 95% 降到 94%（实测 94.5%）。
