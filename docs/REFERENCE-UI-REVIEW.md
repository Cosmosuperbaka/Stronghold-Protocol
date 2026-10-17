# 参考站点 UI 源码对照（2026-10-17）

参考：https://weishuxieyi.xiaolubao.com/ 。本次通过公开 HTTP 获取原始 JS / CSS，并与首页实际加载的
`index-B7-t61a7.js`、`index-CCQriwzN.css` 交叉核对交流组件结构和关键样式。未读取私有后端或加入线上房间。
原始文件、URL、SHA-256 与对照说明保存在维护者本机 `E:\暂存文件夹\github_data\stronghold-ui-source-20261017`。
仓库只存本库适配代码和此文档，不复制整个站点或新增游戏美术。

## 后续跟进与私有归档

归档仓库：[zhewang448/stronghold-ui-site-archive](https://github.com/zhewang448/stronghold-ui-site-archive)（私有，需仓库访问权限）。
参考站：[weishuxieyi.xiaolubao.com](https://weishuxieyi.xiaolubao.com/)；公开源码上游：
[xinhai-ai/Stronghold-Protocol](https://github.com/xinhai-ai/Stronghold-Protocol)。线上部署与 GitHub 提交可能不同，应分别比较。

1. 更新本机公开上游 checkout `stronghold-ui-upstream-archive-source`。
2. 在私有归档库目录运行 `python tools/capture.py --upstream ../stronghold-ui-upstream-archive-source`；若上游目录放在其他位置，替换参数路径。
3. 查看 `changes.json`、`manifest.json` 和 `git diff -- live/ upstream-frontend/`：`live/` 为线上文件，`upstream-frontend/` 为 GitHub 补充；`changes.upstream` 单列上游文件增删和变化。
4. 按需将变化适配到本库，完成验证后再提交；归档快照的提交与上传也按维护者当次授权执行。

不可获取路径及撤去文件以当次清单为准，磁盘保留的旧文件不代表仍在线。归档只包含可获取的公开前端，
不包含私有后端、游戏素材或用户数据；目前没有自动定时抓取。

## 已移植：交流面板

以 [原组件](https://weishuxieyi.xiaolubao.com/js/ui/emotes.js) 和
[原样式](https://weishuxieyi.xiaolubao.com/css/emotes.css) 为外观依据：

- 左侧 40px 图标栏，表情 / 聊天历史切换；历史显示条数、玩家和时间。
- 桌面 260px 面板、44px 高表情格；移动断点 220px 面板、32px 高表情格；三列两行、4px 间距。
- 底部单行输入、字数、发送按钮，输入框高 24px，触屏输入保留 16px 防聚焦缩放。
- 文字气泡复用 `EmoteBubble`：6px 圆角、深绿背景、细边框，无三角尾巴，默认约 3 秒 pop/fade。
- 单独适配本库 `room.chat`、200 字上限、屏蔽词、观战权限、断线与失败草稿；不采用参考站的 20 字协议。
- 本库多语言错误 / 只读提示、未读标记与长消息三行上限为兼容补充，正常面板结构与参考站一致。

仅 `emotes.css` 增加交流规则，不改全局 rem、设置面板、HUD 或商店。等待室、开局说明、轮选和结算继续
使用原可拖动文字聊天。源码公开并不代表所有素材授权一致，本次未下载新美术；致谢见 [NOTICE.md](../NOTICE.md)。

## 本次继续落地（2026-10-17）

- **大厅统计入口**：干员调配下方复用参考站的 `HubTile`，图表图标、统计数据与 LOCAL RECORDS，接本库 `openStats`。
- **快捷键独立弹窗**：设置正文只留「修改快捷键」入口；子弹窗保留七项键位、重复键交换、恢复默认。
  编辑时 Esc 取消捕获，再按 Esc 关闭子弹窗并返回入口，设置仍保持打开；触屏显示实体键盘提示。
- **资源分阶段进度**：现有分包链路增加下载字节 / 采样速度、整包 SHA-1 校验状态、缓存导入文件数。
  校验阶段不显示虚假百分比；失败继续走原镜像与逐文件回退，暂停仍可取消。
- **公告长文排版**：主机控制台显式选择 Markdown，最多 20000 个 Unicode 字符；旧纯文本保留 500 字与原样显示。
  延迟加载 Marked 仅用来分词，固定 Preact 节点渲染标题、列表、表格、引用、代码和安全链接；
  HTML 按文字显示，图片降为替代文字，超深 / 超多节点回退到纯文本。横幅长文仅提示点击查看详情。

三项均复用本库逻辑，没有恢复整体界面缩放。源码归档保存在维护者私有库
[stronghold-ui-site-archive](https://github.com/zhewang448/stronghold-ui-site-archive)：661 份线上公开文件，
另有 663 份 GitHub 前端 / 浏览器共享模块补充。每份线上文件有来源、抓取时间、哈希；未公开路径单列，
不声称取得私有后端或未暴露源码。归档工具支持重新抓取与差异报告，尚未设置定时抓取。

## 对照与后续可选 UI

下表记录原始对照及建议范围；快捷键、资源进度、公告长文已按上一节实现。

| 建议 | 参考站具体实现 | 本库现状与收益 | 建议范围 |
| --- | --- | --- | --- |
| 优先：快捷键独立编辑弹窗 | `js/ui/settings.js` 的 `ShortcutModal`，设置中只放「修改快捷键」入口 | 已改为独立编辑弹窗，设置正文保留入口 | 只移植弹窗结构，保留本库键位、重复键交换和 Esc 取消规则，不整体移植缩放 |
| 优先：资源包下载进度与导入进度分开 | `js/ui/resourcePanel.js` 显示下载速度、下载进度、正在导入的文件进度 | 本库已有分包下载及 `packProgress`，面板仅显示总状态与 ZIP 操作条；下载 / 校验 / 写缓存时容易分不清阶段 | 先接已有阶段 / 字节字段；速度需要采样，不能把站点的并发数量 UI 直接接到本库逐包实现 |
| 可选：皮肤总显示开关 | `js/ui/skinPicker.js` 的 disabled 状态和启用按钮，`settings.js` 中 `skinsEnabled` | 本库已移植加载失败 / 重试 / 未安装状态，但没有总开关；低配置设备可保留已选皮肤同时临时显示默认外观 | 需同时适配模型、头像与立绘读取，属于新增产品行为，单独实现；不能只加开关外观 |
| 可选：公告长文排版 | `js/ui/announcement.js` 按 format 延迟加载 `announcementMarkdown.js` | 已支持显式 Markdown 长文；标题、列表和链接帮助分段阅读 | 需增加受限 Markdown 渲染与链接校验，不执行任意 HTML，不引入其宣传区域 |
| 小改：游戏内设置提供公告入口 | `settings.js` 的 actions 中含 `AnnouncementButton`，先关闭设置再打开公告 | 本库公告入口主要在标题 / 大厅 / 房间与棋盘角落，设置页只放说明和完成；可在不退出当前流程时重看公告 | 复用本库公告系统，保留内容和焦点返回，不引入站点额外宣传区域 |

以上源码分别可从公开 `/js/ui/settings.js`、`/js/ui/resourcePanel.js`、`/js/ui/skinPicker.js` 获取。
原站快捷键集合和冲突处理与本库不同；不能整体替换设置 store 或快捷键逻辑。

## 本库已具备、无需重复移植

- 数字表情页码、皮肤未安装 / 失败 / 重试状态、海报与结算立绘、协议独立选择页。
- 四语语音多选预载、资源分包传输和失败后逐文件回退。
- 公告提示及本机历史统计已有独立实现；只为“更像”而整体替换会扩大兼容成本。

整体管理界面缩放曾引入比例异常，此次不恢复。参考站的赞助 / 付费区域不属于本库移植范围。

## 验证入口

`test/ui/match-communication.e2e.test.js`：1440×900、844×390、640×360，验证源码几何参数、左侧图标、
表情与历史切换、输入法、失败草稿、Esc 焦点返回、真实服务器屏蔽词与 200 字消息、头像气泡和观战只读。
手机翻页使用 Chromium 合成触摸；无法代替真机 Safari、软键盘和刘海屏验收。
`test/ui/emotes.e2e.test.js`、`chat.e2e.test.js` 与 `chat-preview.e2e.test.js` 为原行为回归。

三项功能验证：`test/ui/hotkeys.e2e.test.js`、`reference-utilities.e2e.test.js`、`announcement-markdown.test.js`、
`test/resources/resource-packs.test.js` 与 `test/announcements.test.js`。资源阶段组件展示使用固定进度样例；
真实下载 → 校验 → 导入与失败重试由资源包管线测试覆盖。

本次验证结果（2026-10-17）：655 项静态 / 资源 / 多语言测试通过；73 项公告、分包管线、快捷键与文档测试通过；
快捷键 4 项、公告与资源展示 1 项、设置入口 1 项、交流移植 2 项浏览器检查通过。`npm run typecheck`、
四个语言包严格检查与 `git diff --check` 通过；全库 ESLint 无错误（有既存警告）。实现阶段未重复跑全量 CI；正式发布验证见 [RELEASE-CANDIDATE.md](RELEASE-CANDIDATE.md)。
截图位于忽略的 `test/e2e/out/`：`hotkeys-phone.png`、`reference-announcement-{1440,844,640}.png`、
`reference-resource-{download,verify,import}-640.png`。浏览器为本机 Edge 无头模式；资源阶段展示使用样例数据，
真实阶段顺序、校验及镜像回退由分包测试验证。Impeccable 检查只报告既有侧边强调样式，新区域无新增问题。
