# 社区插件检索记录

核对日期：2026-10-16。仅检索公开仓库与作者说明，未安装，未在本扩展分支测试兼容性。

| 项目 | 已公开内容 | 兼容边界 |
|---|---|---|
| [Stronghold-Protocol-Forge-Mods](https://github.com/XiaMo233M/Stronghold-Protocol-Forge-Mods) | Forge 工坊包与作者文档；`mods/index.json` 为成品镜像索引，`packs/` 为作者维护的兼容包 | 配套 [Stronghold-Protocol-Forge](https://github.com/XiaMo233M/Stronghold-Protocol-Forge) 的工坊与 MOD API；本库未验证这些包可直接导入原生插件工作台，不自动安装 |
| [Lele Mods](https://github.com/llleeeqi/Stronghold-Protocol-Lele-Mods) | 额外回合、更多阵营、收藏品、新干员、伤害统计、恭喜发财、额外干员、定向自选，共八项 | 作者标注适配 0.3.0，但必须配套 Lele 宿主 API 1；不能直接安装到纯原版 0.3.0，本库尚未接入该宿主 |
| [sp-mp](https://github.com/secret-c/stronghold-protocol-plugins) | README 标注 1.6.1：4/8/12 人房、聊天、伤害与最近一局统计、卡池、商店禁用、偏好盟约 | 适配 0.2.6，通过独立启动器/覆盖层加载；不是直接放进官方工作台的通用 0.3.0 插件，与本库功能有重叠 |
| [PRTS Terminal 提案 #661](https://github.com/sganggs/Stronghold-Protocol/pull/661) | Takethetrain 的 Web 控制台、AI 接管、资源修改工具 | 核对时未合并；属于独立工具提案，与本库控制台重叠，不是已验证可安装的原生插件包 |

Lele README 列出的来源还有 [Rhine](https://github.com/YUYUYUYUYUYUYUTOUA/Stronghold-Protocol-Rhine)、[收藏品 DLC](https://github.com/UNDFFIO/Stronghold-Protocol-dlc)、[Rem](https://github.com/remember-4/Stronghold-Protocol-Rem)，以及 Stardust-minus 伤害统计、RiZhiZhaoYi 恭喜发财、Lunac1a 干员扩展、Strinova-xinghui 定向自选。这些多为改版分支，公开源码不等于可直接导入官方插件工作台。

检索方法：GitHub 仓库搜索 Stronghold-Protocol plugin、Stronghold-Protocol 插件，以及上游 issue/PR 检索。结果中的 nonebot-plugin-stronghold-protocol 属于机器人集成，未列为游戏原生插件；未访问本地机器人目录。

控制台入口：设置 → 插件管理 → 打开插件工作台。由本机会话验证后，跳转到游戏实际端口的 /studio/，沿用工作台自身钥匙和访问限制。插件工作台禁用时显示原因。本次不自动安装社区代码。
