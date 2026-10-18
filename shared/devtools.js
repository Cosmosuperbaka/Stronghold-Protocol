// i18n-ignore-file: Chinese labels for the local host's developer tools and mock switcher.
// Keep the console's direct links and the mock's phase buttons on the same catalogue.
export const DEV_PAGES = [
  ['game-mock.html', '对局界面模拟', '切换开局、策略、备战、战斗和结算，使用模拟数据预览实际界面。'],
  ['sim-check.html', '战斗模拟校验', '检查浏览器战斗模拟与参考结果是否一致；需要先生成校验数据。'],
  ['render-demo.html', '战场渲染预览', '播放录制战斗，检查棋盘、镜头、干员模型与动画。'],
  ['fx-viewer.html', '官方特效查看', '按特效键、干员或技能预览官方战斗特效；需要对应素材。'],
  ['battle-perf.html', '战斗性能测试', '运行战斗压力场景，观察帧率和耗时表现。'],
  ['uikit.html', '界面组件图册', '查看按钮、面板、图标等界面组件的样式和状态。'],
];

export const DEV_SCENES = [
  ['确认本局信息', 'INFO_CHECK', ''],
  ['选择策略（同盟）', 'BAND_DRAFT', ''],
  ['选择策略（独立）', 'BAND_DRAFT', 'solo'],
  ['协议启动动画', 'BATTLE_CHECK', ''],
  ['休整期 · 常规备战', 'PREP', ''],
  ['休整期 · 晋升奖励', 'PREP', 'reward'],
  ['休整期 · 临时整备区', 'PREP', 'temp'],
  ['休整期 · 商店冻结', 'PREP', 'frozen'],
  ['休整期 · 已被淘汰', 'PREP', 'dead'],
  ['领袖战备战 · 左侧', 'PREP', 'boss'],
  ['领袖战备战 · 右侧', 'PREP', 'bossR'],
  ['标准模拟 · 同构体与调和', 'PREP', 'funny,morph,harmony'],
  ['机变轮选 · 悬赏决策', 'SP_DRAFT', 'bounty'],
  ['机变轮选 · 补给', 'SP_DRAFT', 'supply'],
  ['机变轮选 · 机密商店', 'SP_DRAFT', 'shop'],
  ['机变轮选 · 战术决策', 'SP_DRAFT', 'tactic'],
  ['机变轮选 · 独立模拟', 'SP_DRAFT', 'solo'],
  ['作战阶段', 'COMBAT', ''],
  ['作战阶段 · 已结束', 'COMBAT', 'done'],
  ['联防阶段', 'UNITE', ''],
  ['联防阶段 · 漏怪计数', 'UNITE', 'leaker'],
  ['回合作战结算', 'SETTLE', ''],
  ['最终攻势', 'FINAL_ASSAULT', ''],
  ['最终攻势 · 即将超时', 'FINAL_ASSAULT', 'overtime'],
  ['最终攻势 · 超时扣血', 'FINAL_ASSAULT', 'drain'],
  ['隐秘核心', 'HIDDEN_CORE', ''],
  ['独立模拟 · 作战暂停操作', 'COMBAT', 'solo'],
  ['独立模拟 · 最终攻势已暂停', 'FINAL_ASSAULT', 'solo,paused'],
  ['胜利结算', 'RESULT', ''],
  ['失败结算', 'RESULT', 'defeat'],
];

export function devSceneUrl(phase, variant = '') {
  return `/dev/game-mock.html?phase=${encodeURIComponent(phase)}${variant ? `&variant=${encodeURIComponent(variant)}` : ''}`;
}
