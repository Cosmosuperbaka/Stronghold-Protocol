# 卫戍协议：盟约 · Stronghold Protocol: Alliance

![扩展版本](https://img.shields.io/badge/version-0.2.5--extended.3-blue)

A non-commercial fan remake of the Arknights mode *Stronghold Protocol: Alliance*, with host tools, collab operators and optional skins.

![license](https://img.shields.io/badge/code%20license-GPL--3.0--or--later-blue)
![node](https://img.shields.io/badge/node-22%20%7C%2024-339933)

在浏览器里招募干员、布置阵容，与朋友合作迎敌。本库提供独立模拟与 1–4 人同盟模拟，空位可由 AI 队友补齐；围绕开服、练习和配装，加入主机控制台、休整期回档、联动自选干员、可选皮肤等扩展。

[下载本库整合包](https://github.com/zhewang448/Stronghold-Protocol/releases/latest) · [扩展更新记录](docs/LOCAL-CHANGELOG.md) · [玩法指南](docs/PLAYING.md) · [反馈问题](https://github.com/zhewang448/Stronghold-Protocol/issues)

> 当前版本为 **`v0.2.5-extended.3`**，基于上游 `0.2.5`。完整素材包包含 11 个官方战场场景、官方 3D 棋盘、40 组召唤物模型、中文 / 日文语音和 174 套可选皮肤。游戏内基础版本显示 `0.2.5`，扩展修订号以下载页标签和附件文件名为准。
>
> 非官方、非商业同人项目，与《明日方舟》官方无隶属或授权关系。游戏名称、美术、音频、文本与数据的权利归原权利人；仅供学习和个人非商业使用。

本次更新新增整局回放：默认录制并保留最近 50 局，在控制台按回合查看阵容、敌人和结果，播放普通战斗与联防。记录页可删除单局，设置页可清理对局结果、回放及控制台操作日志。发布包新增 Ed25519 签名，控制台更新可核验经镜像下载的安装包。

本地主机控制台、回档、逐回合统计、7 名联动自选干员、自定义同盟密钥和皮肤功能继续保留。回档会恢复首领搭档和左右半场；只改潜能 / 练度也能导出调配。完整记录见[扩展更新记录](docs/LOCAL-CHANGELOG.md)。

## 开始运行

需要 **Node.js 22 或 24** 和支持 WebGL 的现代浏览器；Windows、macOS、Linux 均可开服。手机建议横屏游玩，战斗在玩家浏览器中模拟，设备性能会影响流畅度。

### 下载整合包

从[本库 Releases](https://github.com/zhewang448/Stronghold-Protocol/releases)选择附件，解压到新目录：

- **独立模拟**（单人）与**同盟模拟**（1–4 人**合作**，没有 PvP；空位可以加 AI 队友）。
- 服务器是一个 Node.js 程序，**战斗在各玩家的浏览器里模拟**（和官方一样），服务器只管经济与回合，一台低功耗小主机就能开服。
- 当前版本 0.2.6：减轻开服电脑的流量（静音时不下载背景音乐、WebSocket 消息压缩、素材地址带内容哈希长期缓存、brotli 压缩、教程图改用 WebP），官方场景光照改回官方值，每回合开始重播干员入场动画，新增「弹药数量」选项，并修复了单位多时模型被裁切、留下残影等 0.2.5 发布后反馈的问题，详见 [CHANGELOG.md](CHANGELOG.md)。仍有少数规则按推断实现，与官方不一致的地方欢迎在 Issue 里反馈。

| 附件 | 适合的情况 |
| --- | --- |
| `*-assets.zip` | 带游戏代码、运行依赖、11 个官方战场场景、官方 3D 棋盘等本地素材与 174 套可选皮肤，适合希望直接启动的玩家 |
| `*-lite.zip` | 带同版代码与运行依赖，首次启动时联网下载默认素材；官方战场场景、棋盘等本地素材和可选皮肤需另行导入 / 安装 |
| `SHA256SUMS.txt` | 用于核对安装包的 SHA-256 校验值 |
| `SHA256SUMS.txt.sig` | 维护者对校验值的 Ed25519 签名，控制台更新据此确认安装包来自本库；更早的版本没有此附件 |

- **Windows**：双击 `scripts/start-windows.bat`。
- **macOS / Linux**：在解压后的项目目录运行 `bash scripts/start.sh`。

脚本会检查环境与素材、启动服务器并打开浏览器。默认游戏地址为 `http://localhost:3000`，主机控制台地址见启动日志的 `Console:` 行，默认是 `http://127.0.0.1:3100`。

从旧版首次升级到本版时，先停止服务器，保留旧目录中的 `logs/`，再解压新包并迁移需要的记录和设置。之后可在本机控制台选择版本自动更新；有正在进行的对局时需确认结束对局。自动更新保留本机素材，新增素材需另行补齐，详见[部署说明](docs/DEPLOY.md#本库拓展版控制台下载并安装)。

本版沿用 `v0.2.5-extended.1` 的完整素材，含 11 个官方战场场景；缺少场景时 3D 棋盘自动回退为金属地块。旧版本附件保持原样，源码 / 轻量包补齐方法见[部署说明 §6](docs/DEPLOY.md#6-本地客户端素材可选)。

<<<<<<< HEAD
### 从源码运行
=======
- **完整包** `Stronghold-Protocol-v<版本>.zip`（约 560 MB，解压后约 790 MB）：附带全部美术 / 音频（含中文、日文两套干员语音、官方 3D 棋盘贴图和各战场的官方场景），解压就能玩，不需要再下载任何东西。**推荐。**
- **精简包** `Stronghold-Protocol-v<版本>-lite.zip`（约 22 MB）：不带素材，第一次启动时自动从公开镜像下载美术、Spine 模型、音频、字体、表情和「玩法说明」教程图（约 550 MB，可中断，再次启动会续传）；官方 3D 棋盘等本地客户端素材不在其中（见下面的「本地客户端素材」；各战场的官方场景可以用 `node tools/setup.mjs --scenes` 在本机下载并提取）。适合下载大文件不方便的情况。
- **更新包** `Stronghold-Protocol-v<版本>-update.zip`（0.2.1 起提供，大小看改动多少，通常只有几 MB）：只含比之前的 0.2.x 版本改动过的文件，用来把已经装好的 0.2.x（完整包或精简包装的都行）升级到新版本，不用重新下载整个包。用法：先停止服务器（关掉窗口；装了开机自启的运行 `scripts\install-service-windows.ps1 -Stop`），把 zip 里 `Stronghold-Protocol` 文件夹的全部内容合并到安装文件夹、覆盖同名文件（Windows 资源管理器里复制粘贴即可；macOS 不要用访达拖放，它会整个替换文件夹，请用 `unzip -o`，见 [docs/DEPLOY.md](docs/DEPLOY.md) 第 1.5 节），再照常启动。启动时会先核对全部程序文件、删除新版本不再用的旧文件，然后正常运行；如果这个文件夹不是更新包对应的版本（例如 0.1.x，或者程序文件被改过），会提示下载完整包，服务器不启动。全新安装请用完整包或精简包。
>>>>>>> v0.2.6

```powershell
git clone https://github.com/zhewang448/Stronghold-Protocol.git
cd Stronghold-Protocol
npm install
npm run setup
npm start
```

`setup` 准备数据和默认素材；下载中断后可重新运行续传。网络下载失败时可尝试：

```powershell
node tools/setup.mjs --asset-source=mirror
```

需要皮肤时另外安装，然后重启服务器并刷新游戏页面：

<<<<<<< HEAD
```powershell
node tools/install-skins.mjs --all
```
=======
| 项目 | 要求 |
|---|---|
| 开服的电脑 | Windows / macOS / Linux，Node.js 22 或 24（LTS）；磁盘约 700–850 MB（素材、依赖与本地提取贴图：完整包解压后约 790 MB）；内存空闲约 100 MB，每局再加几 MB |
| 玩家 | 支持 WebGL 的现代浏览器（Chrome / Edge / Firefox / Safari 最新版），电脑、手机或平板（横屏） |
| 网络 | 首次进入游戏时，每位玩家要从开服的电脑下载几十 MB 素材（之后走浏览器缓存）；对局中流量很小 |
>>>>>>> v0.2.6

安装选项、失败重试与资源范围见[皮肤说明](docs/SKINS.md)。启动有问题时运行 `npm run doctor`，检查 Node 版本、素材、端口与网络配置。

表情和「玩法说明」的教程图随上面的素材一起从公开镜像下载。源码和轻量包的默认下载流程不含上述官方棋盘等素材；可从**同一基础版本**的上游完整包复制 `public/assets/local/` 和 `data/local-assets.json`，或从本机游戏客户端提取，具体见[部署说明](docs/DEPLOY.md)。

## 本库特色

<<<<<<< HEAD
以下图片来自本库真实界面，使用测试房间和演示数据；部分截图裁剪了无关区域。
=======
| 环境变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `3000` | 监听端口 |
| `HOST` | `::` | 监听地址。默认 `::` 是双栈：同一个端口同时接受 IPv6 和 IPv4；`0.0.0.0` = 只 IPv4；`127.0.0.1` = 只允许本机，放在反向代理后面时使用 |
| `SP_COMBAT` | `client` | `client`：各玩家浏览器模拟自己的战斗（服务器负载极低）；`server`：由服务器模拟并推流 |
| `SP_VERIFY` | `off` | 服务器复算客户端上报的战斗结果：`off` / `sample`（约 1/8 抽查）/ `all`（全部复算，更耗 CPU） |
| `TRUST_PROXY` | `auto` | 是否信任 `X-Forwarded-For` 等转发头：`auto` 只信任来自本机 / 内网的代理；`1` 总是；`0` 从不 |
| `DEBUG` | 空 | 设为任意值输出详细日志 |
| `SP_NO_BROWSER` | 空 | 设为 `1` 时启动脚本不自动打开浏览器 |
| `SP_BOT_EMOTES` | 空 | AI 队友的对局表情回应（战斗、整备、合成、联防、收礼时即刻的 `m.emote` 广播）；设为 `0` 时整体关闭 |
| `SP_ASSET_INDEX` | 空 | 素材地址带内容哈希、浏览器长期缓存（0.2.6 起默认开启，哈希存在 `.cache/asset-hashes.json`）；设为 `0` 时关闭，素材清单原样下发 |
>>>>>>> v0.2.6

### 主机控制台：调试阵容与管理对局

在开服电脑上打开控制台，即可查看房间和玩家，修改 LP、金币、商店等级与盟约层数，发放干员、道具和机变卡，编辑棋盘。发放自选干员时可选择阶级、普通 / 精锐、技能与模组，也可调整已有自选干员的技能。

![主机控制台：房间操作、玩家数值和灰烬自选干员候选列表](docs/img/features/host-console.webp)

控制台还支持结束休整期、暂停独立模拟、判定战斗胜负（客户端战斗模式）、结束对局与关闭房间。主机修改直接生效、不扣金币，使用前请与同局玩家约定。

发放装备或直接给干员装备超过共享库存时，会弹窗询问是否强制加入；点「是，强制加入」才发放，点「否」或按 Esc 取消。强制发放仍占库存、遵守手牌和整备区容量，商店缺货时仍不能购买。缪尔赛思等固定特质赠送自动突破库存限制；最终攻势（第 14 回合）进入隐秘核心前也会保存干员伤害。旧记录缺失的伤害无法补回。

- **休整期回档**：每次进入休整期自动保存快照，可整局恢复到指定回合的休整期开始，随机数状态与统计一并恢复；对局结束后不能回档，服务器重启会清空快照。
- **敌人日程**：查看候选组合、概率与实际出怪，并指定某回合的敌人组合。该面板包含剧透，默认折叠。
- **准备时长**：可按倍率、统一秒数、逐回合时长或不限时设置，适用于所有房间。
- **可选联防叠层**：控制台「设置 → 联防叠层」开启，默认关闭。从下一次联防起，援助干员重新获得每场叠层额度，新增层数在结算时保留，上限仍为 999；最终攻势和隐秘核心不受影响。设置在重启后保留。

控制台仅监听本机 `127.0.0.1`，不会随游戏的局域网地址或公网隧道开放。`SP_ADMIN_PORT` 可改控制台端口，`SP_ADMIN=0` 可关闭它。完整操作与回档说明见[扩展开发笔记](docs/LOCAL-DEV.md)。

### 控制台自动更新与多版本选择

每次服务器启动后，第一次打开控制台会自动检查本库正式 Release，有新版时弹窗提醒；同次启动刷新或多开页面不会重复自动检查。在「设置 → 版本更新」也可手动检查，选择标有**新版本、当前版本、旧版本**的 Release，并加载更早版本。点击后自动下载、校验、备份、安装并重启；回退旧版本或结束正在进行的对局前，需要确认。

「更新网络配置」支持保存 **HTTP / HTTPS 代理**和备用镜像地址；代理留空则直连 GitHub，访问失败后自动切换镜像，版本查询、校验文件和安装包下载都适用，配置在重启后保留。安装保留本机素材、主机设置和对局记录，程序替换失败会恢复旧文件。

此功能从 `v0.2.5-extended.2` 起提供；旧版首次升级需手动下载本版。自动更新只替换程序，新增素材需另行补齐，回退旧版可能不兼容新版设置或记录。使用方法与网络配置见[部署说明](docs/DEPLOY.md#本库拓展版控制台下载并安装)。

### 逐回合统计与历史对局

控制台提供回合曲线、逐回合详情、累计及单回合干员伤害排行，并可按玩家筛选。对局结束后的记录保存到服务器 `logs/results/`，可在「对局记录」中回看。

整局回放默认开启，保存到 `logs/replays/`，保留最近 50 局；自动清理仅删除回放文件。「对局记录 → 回放」可按回合查看实际阵容、敌人和已采纳结果，播放普通战斗与联防，支持暂停、继续、重播及 1/2/4/8 倍速，结束后核对结果。领袖战仅展示结果；版本变化可确认后尝试播放。旧记录无法补录。记录页可删除单局结果与关联回放，「设置 → 数据清理」可分别清理对局结果、回放和控制台操作日志。

![主机统计：两回合演示记录、逐回合伤害排行及推进之王与灰烬的累计伤害](docs/img/features/round-statistics.webp)

图中数据用于展示界面。服务器主机记录与游戏内「统计（本机）」各自保存；后者存放在玩家浏览器里，可导入和导出。

### 联动自选干员与可选皮肤

自选池共 **79 名**干员，包含 **灰烬、艾拉、麒麟R夜刀、玛露西尔、丰川祥子、结城理、焰狐龙梓兰**这 7 名联动干员，可在「干员调配 → 自选编队」配置，也可由控制台发放。

皮肤目录覆盖 **115 名干员、174 套皮肤**。安装资源后，在调配或自选面板选择外观；也可用「随机装备皮肤」为干员随机选择已安装、可用的非默认皮肤，没有可用皮肤时使用默认外观。选择支持调配文件导入 / 导出，并在联机、重连和观战中同步。

![干员调配：隐现的皮肤选择与顶部随机装备皮肤按钮](docs/img/features/operator-skins.webp)

皮肤只改变外观，不改变战斗数值或战斗哈希。商店、奖励和详情页半身立绘仍使用默认资源；专属视觉效果有部分尚未完成，详见[皮肤说明](docs/SKINS.md)和[联动实现说明](docs/LOCAL-DEV.md#8-联动干员进自选池)。设置里还可手动预加载画面素材或全部素材，查看进度并取消。

### 自定义同盟密钥

创建同盟时可填写 **4 位英文字母或数字**，不区分大小写；留空自动生成。密钥被占用时会提示更换，房间解散后可再次使用。创建后分享密钥或邀请链接，朋友即可加入或观战。

![同盟创建界面：在创建按钮上方填写自定义同盟密钥 D1I0](docs/img/features/custom-room-key.webp)

### 禁用干员按盟约分组

开局简报、策略选择弹窗与局内「本局信息」统一按盟约显示禁用干员，配有盟约图标、名称、人数和干员头像，组内按阶级排列。多盟约干员会在各所属盟约下显示，禁用总数去重计算。

![本局信息禁用列表局部：灵巧、奥术、奇迹、投资人、突袭和独行分组](docs/img/features/banned-operator-groups.webp)

此项从 `v0.2.4-extended.3` 起包含在整合包中。

## 和朋友一起玩

1. 主机启动服务器，将启动日志里的**局域网游戏地址**发给朋友；同一网络的玩家在浏览器里打开它。
2. 选择「同盟模拟」并创建同盟，分享 4 位密钥或邀请链接。
3. 等待朋友加入，或加入 AI 队友填补空位，再开始对局。

不在同一局域网时，Windows 可用本库开服脚本生成临时公网地址。先安装 Node.js 与 cloudflared，并完成游戏环境准备：

```powershell
winget install Cloudflare.cloudflared
.\scripts\start-tunnel.bat
```

脚本会先结束占用游戏端口的旧服务器 / 隧道，再启动游戏与 cloudflared，显示本机、局域网和公网地址。临时隧道地址每次启动可能变化；按 `Ctrl+C` 或关闭窗口停止。可用 `--port 3001` 改游戏端口，或用 `--no-tunnel` 只开局域网；停止脚本为 `scripts/stop-server.bat`。后台常驻与脚本参数见[开服脚本说明](scripts/README.md)。

自建反向代理需要转发 WebSocket `/ws`，并在域名根路径运行单个常驻 Node.js 实例。游戏没有账号系统，知道游戏地址的人即可进入。主机控制台留在开服电脑本机使用。

刷新或断线后，同盟模拟可在 **10 分钟**内重连，独立模拟可在 **24 小时**内恢复原座位，前提是服务器和该对局仍在运行。房间、对局与回档快照保存在内存中，**重启服务器会结束所有对局**。

## 操作

休整期招募、配装与部署，作战期自动迎敌；漏怪时顶栏用红字 + 「−N」标记待扣的目标生命值，结算时才显示扣除后的数值。点击干员按地上的方格定位。

| 操作 | 方法 |
| --- | --- |
| 购买 / 升级 / 机变选卡 | 点一次选中，再点一次确认 |
| 部署 / 移动 | 将干员拖到棋盘格，方向轮盘选择朝向后松手 |
| 调整朝向 | 拖回干员自己的格子，重新选择方向 |
| 配装备 | 拖到干员所在格；每人 2 件，替换会销毁旧装备，已配发的装备锁定在干员身上 |
| 查看详情 | 右键或长按单位 / 卡牌 |
| 常用快捷键 | `R` 刷新、`F` 冻结、`D` 升级、`Q` 撤退、`X` 出售、`Space` 准备就绪、`Esc` 取消 / 关闭；在设置中查看或修改 |
| 暂停（独立模拟） | 作战中点「暂停」或按 `Space`；同盟模拟的作战不能暂停 |
| 本机统计 | 从标题画面、大厅或等待室进入「统计」 |

详细规则、观战、快捷键与玩法说明见[玩法指南](docs/PLAYING.md)。界面支持简体中文、English、日本語、한국어、繁體中文；在标题画面或设置中切换。

## 配置与数据保存

| 环境变量 | 默认值 | 作用 |
| --- | --- | --- |
| `PORT` | `3000` | 游戏端口 |
| `HOST` | `::` | 游戏监听地址，支持 IPv4 / IPv6；仅本机使用可设为 `127.0.0.1` |
| `SP_ADMIN_PORT` | 游戏端口 + 100 | 本机控制台端口 |
| `SP_ADMIN` | `1` | 设为 `0` 关闭控制台 |

游戏默认端口为 `3000`。例如在 PowerShell 中改为 `8080`：

```powershell
$env:PORT = '8080'
npm start
```

| 内容 | 保存位置 | 重启服务器后 |
| --- | --- | --- |
| 房间、正在进行的对局、回档快照 | 服务器内存 | 清空 |
| 主机历史对局 | `logs/results/` | 保留 |
| 主机时长与联防叠层设置 | `logs/admin-settings.json` | 保留 |
| 玩家身份、调配、皮肤偏好、本机统计 | 玩家浏览器本地存储 | 保留；更换浏览器或清除站点数据会影响恢复 |
| 下载的游戏与皮肤素材 | `public/assets/` 等本地资源目录 | 保留 |

数据位置与分享前的隐私检查见[本地数据说明](docs/PRIVACY.md)。更多部署选项见[部署说明](docs/DEPLOY.md)。

## 文档与开发

| 文档 | 内容 |
| --- | --- |
| [扩展更新记录](docs/LOCAL-CHANGELOG.md) | 本库扩展、版本与验证记录 |
| [CHANGELOG.md](CHANGELOG.md) | 上游基础版本更新记录 |
| [扩展开发笔记](docs/LOCAL-DEV.md) | 控制台、回档、联动干员等实现细节 |
| [皮肤说明](docs/SKINS.md) | 安装、外观同步、随机装备与预加载 |
| [开服脚本](scripts/README.md) | Windows 隧道、停服与后台运行 |
| [架构](https://github.com/zhewang448/Stronghold-Protocol/blob/main/docs/ARCHITECTURE.md) / [设计](https://github.com/zhewang448/Stronghold-Protocol/blob/main/docs/DESIGN.md) | 代码入口、当前规则与接口约定（在线开发文档） |
| [贡献指南](https://github.com/zhewang448/Stronghold-Protocol/blob/main/CONTRIBUTING.md) / [助手指引](https://github.com/zhewang448/Stronghold-Protocol/blob/main/AGENTS.md) | 环境准备、改动与验证要求（在线开发文档） |

```powershell
npm test             # 单元与集成测试，约 6400 项
npm run ci           # 测试、启动 smoke、lint、导入边界与类型检查
npm run golden       # 确定性战斗与整局黄金结果
```

先运行改动涉及的测试，再执行完整检查。真实浏览器测试需要系统 Chrome / Edge 和对应的环境开关，配置见[贡献指南](https://github.com/zhewang448/Stronghold-Protocol/blob/main/CONTRIBUTING.md)。生成数据通过 `npm run build-data` 更新，不手工编辑 `data/*.json`；不将下载或提取的游戏素材提交到仓库。

问题和功能建议请提交到[本库 Issues](https://github.com/zhewang448/Stronghold-Protocol/issues)，说明运行方式、扩展版本、复现步骤与相关日志。

## 来源与许可

本库在原项目基础上继续开发；原项目的介绍、版本记录及致谢统一见[原项目 README](https://github.com/sganggs/Stronghold-Protocol/blob/master/README.md)。本库扩展的参考来源记录在相应开发文档中。

<<<<<<< HEAD
代码以 **GPL-3.0-or-later** 发布，见 [LICENSE](LICENSE)。游戏素材与数据不适用代码许可证；版权、Spine 组合分发附加许可和第三方组件说明见 [NOTICE.md](NOTICE.md) 与 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。本项目保持非商业使用，不接受广告、付费服务或其他变现功能。
=======
欢迎提 Issue 反馈 bug、与官方规则不一致的地方或改进建议，也欢迎提交 Pull Request：

- 准备环境、运行测试、忠实原则和提交约定见 [CONTRIBUTING.md](CONTRIBUTING.md)。
- 提交前请运行 `node --test`，并同步更新相关文档；文档使用简体中文，代码与注释使用英文。
- 提交的代码将以 GPL-3.0-or-later 发布。
- 请不要提交任何游戏素材文件（`public/assets/` 等目录已被 `.gitignore` 排除）。
- 本项目坚持非商业：请不要提交广告、付费、打赏等任何形式的变现功能。

---

## English

An **unofficial, non-commercial fan remake** of Arknights' seasonal auto-chess tower-defense mode *Stronghold Protocol: Alliance*, played in the browser: solo, or 1–4 player co-op (AI teammates can fill seats). Combat is simulated in each player's browser, so a low-power PC can host.

- **Run:** download the full bundle `Stronghold-Protocol-v<version>.zip` (~560 MB, all the art inside, the Chinese and Japanese operator voices and the official battlefield scenes included) from [Releases](../../releases/latest) — or the lite one, `…-lite.zip` (~22 MB), which downloads the art (~550 MB) on its first start; from 0.2.1 on, `…-update.zip` holds only the files changed since the earlier 0.2.x releases: stop the server, extract it over an existing 0.2.x folder and start again (the first start deletes the files the new version dropped and verifies the install) — install Node.js 22 or 24, then double-click `scripts\start-windows.bat` (Windows) or run `./scripts/start.sh` (macOS / Linux) and open <http://localhost:3000>. From source: `npm install && npm run setup && npm start` (setup downloads ~550 MB of art from public mirrors, the emotes and the how-to-play pages included; the official 3D board, some official HUD icons, two enemy models and 39 summon models are extracted from a local Arknights client — without one the game uses the 2D board and look-alike stand-ins (the summons show their avatars), and a server can copy `public/assets/local/` and `data/local-assets.json` from the full bundle of the same version).
- **Languages:** Chinese (the default), English, 日本語, 한국어 and 繁體中文 — switch on the title screen or in Settings. Game texts come from the official clients; the Japanese, Korean and Traditional Chinese interface strings are machine translations (corrections welcome: [docs/I18N.md](docs/I18N.md)).
- **Play with friends:** create a co-op room and share the 4-letter key or the `?room=KEY` link. On a LAN, use the address printed at start; otherwise use a virtual-LAN tool, a tunnel or a VPS — see [docs/DEPLOY.md](docs/DEPLOY.md).
- **Disclaimer:** not affiliated with or endorsed by Hypergryph or Yostar. All Arknights names, art, audio, text and data are © their respective owners and are **not** covered by this project's GPL licence. For study and personal non-commercial use only — no selling, paid distribution, paid servers or monetisation of any kind. Content will be removed on request of the rights holders. Provided "as is", without warranty.
- **License:** code GPL-3.0-or-later ([LICENSE](LICENSE)); game assets excluded.
- **Contributing:** [CONTRIBUTING.md](CONTRIBUTING.md) (an English summary at its end); the code map is [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
>>>>>>> v0.2.6
