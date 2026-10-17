import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderAnnouncementMarkdown, popupContentUrl } from '../../public/js/ui/announcementMarkdown.js';

function nodes(value) {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== 'object') return [];
  return [value, ...nodes(value.props?.children)];
}
const text = value => Array.isArray(value) ? value.map(text).join('') : value && typeof value === 'object' ? text(value.props?.children) : String(value ?? '');

test('announcement Markdown supports long-form structure without HTML injection or remote images', () => {
  const source = '# 更新说明\n\n**重点**与`code`\n\n- 条目\n- [文档](https://example.com/docs)\n\n> 引用\n\n| 项目 | 状态 |\n| --- | --- |\n| UI | 完成 |\n\n<script>alert(1)</script>\n\n![图片](https://example.com/track.png)\n\n[危险](javascript:alert(1))';
  const tree = renderAnnouncementMarkdown(source), all = nodes(tree);
  for (const tag of ['h1', 'strong', 'code', 'ul', 'li', 'blockquote', 'table']) assert.ok(all.some(n => n.type === tag), tag);
  assert.deepEqual(all.filter(n => n.type === 'a').map(n => n.props.href), ['https://example.com/docs']);
  assert.ok(all.every(n => !['script', 'img', 'iframe', 'style'].includes(n.type) && !n.props?.dangerouslySetInnerHTML));
  assert.match(text(tree), /<script>alert\(1\)<\/script>/);
  assert.match(text(tree), /图片/);
  assert.equal(all.find(n => n.type === 'a').props.rel, 'noopener noreferrer');
});

test('announcement URLs reject script, credential, protocol-relative and obfuscated schemes', () => {
  for (const value of ['javascript:alert(1)', '//evil.test', 'data:text/html,x', 'https://u:p@example.com', '/\\evil.test', 'java\nscript:x', '', null]) assert.equal(popupContentUrl(value), null, String(value));
  for (const value of ['/guide', 'https://example.com/path', 'http://example.com']) assert.equal(popupContentUrl(value), value);
  const tree = renderAnnouncementMarkdown('[x](javascript&#58;alert(1))\n\n&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(nodes(tree).filter(n => n.type === 'a' || n.type === 'img').length, 0);
  assert.match(text(tree), /<img src=x onerror=alert\(1\)>/);
});

test('extreme Markdown nesting falls back to readable escaped text', () => {
  const source = '> '.repeat(40) + '正文';
  const tree = renderAnnouncementMarkdown(source);
  assert.equal(tree.type, 'p');
  assert.equal(text(tree), source);
});
