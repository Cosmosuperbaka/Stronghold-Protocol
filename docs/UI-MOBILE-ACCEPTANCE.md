# 手机 HUD 与标点验收（#10）

发布归档：`v0.3.1-extended.5`（2026-10-20）。以下记录开发期间的独立预览与分批验收；发布时合入 main，3010 / 3110 已停止，3000 / 3100 进程保持运行。

## 后续调整：以参考站为基础

2026-10-19 后续按维护者意见引入 `reference-mobile.css`，优先复用线上已部署规则。房间小屏立绘
从约 136×144 的 cover 裁切改为保持 1:2 的 contain，列表滚动保留姓名板；普通桌面仍为原 flex/cover。
顶部 HUD 复用参考站取消最小宽度及压缩装饰的规则。来源、哈希和选择器映射见 REFERENCE-UI-REVIEW。
标点可见按钮从小屏固定 44px 改为 `max(.44rem, 30px)`，独立触摸区保持 44px；
拖动箭头可移动整个工具栏，位置与折叠分别保存，方向键移动、刷新恢复、旋转约束和重置均复用聊天生命周期。
下面首轮记录中的「44px 按钮」指当时版本；最终可见尺寸与有效热区分别验证。

后续验收：`reference-mobile.e2e.test.js` 7 pass、0 fail；检查 1920 桌面保持 flex/cover、
844/640（含特大字号）采用完整立绘与可滚动姓名板、30px 图标的实际 44px 命中范围、
鼠标/合成触摸拖动、折叠不误触、刷新保存、旋转和重置。触摸边界检查发现小屏 scroll-snap
将首个按钮左侧热区滚出，补 `scroll-padding-inline:7px` 后通过，未降低命中断言。
聊天位置/IME 两项、密钥创建加入三组尺寸、标点三条渲染/尺寸路径及六组 HUD 回归通过。
普通桌面 1920×1080、1366×768 基线几何仍无变化；95 项单元/文档、全库 lint/imports/typecheck
及四语言严格检查通过。最终日志为 `.cache/reference-verified.log` 等 `reference-*.log`。
最后一轮旧 HUD/标点复核为 9 pass、1 timeout（引擎用例等待 Esc 取消），同一引擎用例单独
重跑 1 pass、0 fail；不宣称该批首次全绿。参考站继承专项 7 项全通过，独立 smoke 通过。

## 每回合统计小屏适配

紧凑模式压缩标题/标签/内边距和控件，保留正文滚动；关闭按钮 32px、操作按钮最低 30px、原生选择框
字体 16px。曲线按实际宽度与当前文字大小重画，坐标文字至少 12px，刻度降密度并保留首末回合，
数据点不删减；完整图例替代重复末端姓名，点按后可读取所有玩家数值。排行可纵向/横向滚动。
普通桌面及控制台维持原 720×260 曲线规则，不改全局缩放。

- `round-history-mobile.e2e.test.js` 与原有 `round-history.e2e.test.js`：9 pass、0 fail。
- 覆盖 1920×1080、1366×768 触屏电脑、844×390、640×360（普通/特大字号）、560×320、390×844。
- 使用 40 回合、4 名长姓名玩家、24 行排行，验证曲线实际字高、刻度首末值、选择框更新焦点、旋转
  重排和筛选保存、触屏点按提示、CDP 合成横滑、最后一列可达、正文滚到底后关闭可点击。
- 布局/历史单元与集成定向检查 12 项通过；类型与定向 lint 通过。截图 `.cache/round-history-mobile/`，
  日志 `.cache/round-mobile-acceptance-final.log`。本次未重跑完整 CI/Golden（未改玩法）。
- 桌面真实 DOM/SVG 基线对照：1920×1080 鼠标、1366×768 触屏电脑的面板/标题/标签/正文/选择框
  几何与曲线 SVG 均逐项相同，记录 `.cache/round-history-mobile/desktop-comparison.json`。

工作区 `E:\Stronghold-Protocol-ui-mobile`，分支 `codex/ui-responsive-issue-10`，基线 `6568e851`。
预览使用 3010，测试使用动态空闲端口。原 `E:\Stronghold-Protocol` 与 3000 进程未修改、停止或重启。

## 范围与证据

- 原固定标点栏在 640×360 覆盖队友 3–4；详情、统计打开后仍保留被遮挡的标点按钮。
- 新增工具使底部角落增长为三行，原两行偏移和透明热区不再适用，最小手机的实际按钮热区测得 38×38。
- 标点默认展开、手动折叠及浏览器记忆；临时让位与待放置状态独立。紧凑模式测量安全区、屏幕边距、可视窗口、已有控件及棋盘/整备区，窄条内部滑动，按钮不缩小。
- 底部工具在最小触屏使用 44px 单行滑动区；按商店实际位置限制宽度。交流和详情基于实际角落边界；统计和浮动聊天使用可视边界。
- 作战统计存在重复 CSS，且没有消费 JS 已计算的高度/停靠值；已去重并接通。
- 未调整全局 rem、文字大小规则或棋盘镜头；未修改服务端玩法、生成数据及 golden。

## 验证

- `node --test test/ui/hud-layout.test.js test/ui/gameLogic.test.js test/ui/chat.test.js test/ui/combat-metrics.test.js test/docs-consistency.test.js test/docs-paths.test.js`：95 pass，0 fail（文档后续补充后另复核）。
- `SP_E2E=1`：hud-responsive、pings、bond-collapse、round-history 共 13 pass，0 fail；更新后的尺寸/字号/旋转与工具按钮可达性另 7 pass，0 fail。包括合成触摸横滑、折叠取消、刷新恢复、临时面板、安全边距、特大字号及引擎/DOM 两条渲染路径。
- 最小手机布局与 iPhone 模拟触控部署专项：2 pass，0 fail。聊天预览、位置拖动、IME/草稿回归 3 项通过；设置逐点交互 5 项通过。表情 6 项通过；修正其已失效的中文开发事件按钮定位。
- 桌面旧代码/新代码同源对照：1920×1080、1366×768 的顶栏、队伍、商店、底部角落、盟约栏及棋盘投影坐标均无变化。JSON 与截图：`.cache/hud-responsive/`。
- `npm run golden`：roster 49、bonds 46、fields 22、matches 21、standins 10、diy 151，共 299 场景全部匹配。
- 完整 `npm run ci` 首轮：9008 tests，8920 pass，20 fail，2 cancelled，66 skipped。失败包含并发负载下插件/Worker/工作台超时、性能门槛和新增文件未进入 Git 路径枚举；新文件使用 intent-to-add 纳入枚举，未暂存文件内容、未提交。对应 14 个失败文件以 `--test-concurrency=1` 重跑：232 pass，0 fail，0 cancelled。未声称完整 CI 首轮全绿。
- setup、smoke、全库 lint（0 error，既有 warning）、imports、typecheck 通过；多语言严格检查四语言无缺项。日志在忽略目录 `.cache/hud-*.log`。

浏览器为 Windows Edge/Chromium 的视口模拟及 CDP 合成触控；未覆盖实体 iOS/Android、Safari 或真实软键盘。
窗口/软键盘适配通过 visualViewport 事件和纯布局边界验证，不将模拟结果冒充实体设备验证。
