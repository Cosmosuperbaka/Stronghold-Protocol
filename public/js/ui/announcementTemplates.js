// i18n-ignore-file: editable local-console examples; never published automatically.
const lines = value => value.join(String.fromCharCode(10));
export const ANNOUNCEMENT_TEMPLATES = Object.freeze([
  { id: 'maintenance', title: '维护通知', format: 'markdown', level: 'warning', text: lines(['# 服务器维护通知', '', '> 以下为模板，请填写实际时间与影响范围后再发布。', '', '## 维护安排', '', '- **开始时间**：[填写日期、时间和时区]', '- **预计结束**：[填写预计时间]', '- **影响范围**：[填写登录、匹配或对局影响]', '', '## 玩家须知', '', '1. [填写需要提前完成的操作]', '2. [填写进行中对局的处理方式]', '', '维护完成后将另行通知。']) },
  { id: 'update', title: '版本更新', format: 'markdown', level: 'info', text: lines(['# 版本更新说明', '', '**版本**：[填写版本号]', '', '**更新时间**：[填写日期与时间]', '', '## 新增功能', '', '- [填写新增功能]', '', '## 问题修复', '', '- [填写修复内容]', '', '## 使用说明', '', '[填写是否需要刷新页面及其他注意事项]', '', '[查看完整更新记录](https://example.com/changelog)']) },
  { id: 'rules', title: '房间规则说明', format: 'markdown', level: 'info', text: lines(['# 房间规则说明', '', '> 请按实际配置填写，示例不代表当前规则。', '', '| 配置项 | 本服说明 |', '| --- | --- |', '| 联防叠层 | [填写默认值与房主权限] |', '| 休整期时长 | [填写时长或不限时] |', '| 插件内容 | [填写启用内容] |', '', '## 联机须知', '', '- 开局前请确认房间设置。', '- [填写其他约定]', '', '## 反馈方式', '', '[填写反馈渠道]']) },
  { id: 'urgent', title: '临时故障通知', format: 'markdown', level: 'urgent', text: lines(['# 临时故障通知', '', '**当前状态**：[填写已确认的问题]', '', '- **受影响功能**：[填写范围]', '- **临时处理方式**：[填写玩家可执行的操作]', '- **下次进展说明**：[填写时间或更新方式]', '', '> [填写需要特别提醒的事项]', '', '恢复后会更新本公告。']) },
]);
