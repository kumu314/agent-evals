#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// selftest.mjs — 三颗手写迷你解析器的边界样本回归（F6，2026-10-12）。
// 跑法：node --test selftest.mjs（零依赖、零 API、不启动任何套件）。
// 立题：这两套件的判定全押在解析器上——解析器错了，绿是假的。
// 每条用例钉的是「套件真实依赖的行为」，注释里写明它破了会坑在哪。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripPsComments, parseFrontmatter, extractPoems } from './lib/parsers.mjs';

/* ── stripPsComments ──────────────────────────────────────────────────────── */
// 套件用它现读 sync.ps1 的端点名单；漏剥注释会读进被注释掉的旧端点（全报 ABSENT 的假红）。

test('stripPsComments：整行注释被剥，有效行原样保留', () => {
  assert.equal(stripPsComments('$a = 1\n# $old = 2\n$b = 3'), '$a = 1\n\n$b = 3');
});

test('stripPsComments：行内注释从 # 处截断（行级语义，不辨引号内外的 #）', () => {
  assert.equal(stripPsComments("'x' # 尾注"), "'x' ");
});

test('stripPsComments：CRLF 输入不破坏行切分（输出统一为 LF）', () => {
  assert.equal(stripPsComments('a\r\n# c\r\nb'), 'a\n\nb');
});

test('stripPsComments：无 # 的行一字不动', () => {
  assert.equal(stripPsComments('no hash here at all'), 'no hash here at all');
});

/* ── parseFrontmatter ─────────────────────────────────────────────────────── */
// 套件用它校验 name 与目录一致 / name 唯一；解析错 => name-unique 建立在空集上。

test('parseFrontmatter：顶层 key: value 正常解析', () => {
  const fm = parseFrontmatter('---\nname: abc\ndescription: hello\n---\n正文');
  assert.equal(fm.name, 'abc');
  assert.equal(fm.description, 'hello');
});

test('parseFrontmatter：缺起始栅栏 → null（不是空对象——调用方靠 null 跳过）', () => {
  assert.equal(parseFrontmatter('name: x\n正文'), null);
});

test('parseFrontmatter：缺闭合栅栏 → null（半截 frontmatter 不当解析成功）', () => {
  assert.equal(parseFrontmatter('---\nname: x\n'), null);
});

test('parseFrontmatter：>- 块标量折成一行', () => {
  const fm = parseFrontmatter('---\ndescription: >-\n  第一行\n  第二行\n---\n');
  assert.equal(fm.description, '第一行 第二行');
});

test('parseFrontmatter：引号值两侧引号被剥', () => {
  const fm = parseFrontmatter('---\nname: "abc"\ntag: \'x\'\n---\n');
  assert.equal(fm.name, 'abc');
  assert.equal(fm.tag, 'x');
});

test('parseFrontmatter：值里含冒号不误劈（只有第一个冒号是分隔符）', () => {
  const fm = parseFrontmatter('---\nlink: http://a:b\n---\n');
  assert.equal(fm.link, 'http://a:b');
});

test('parseFrontmatter：缩进行不是顶层键，被跳过', () => {
  const fm = parseFrontmatter('---\nname: abc\n  sub: x\n---\n');
  assert.deepEqual(Object.keys(fm), ['name']);
});

/* ── extractPoems ─────────────────────────────────────────────────────────── */
// merge-eval 用它切 POEMS 数组文本再做 JSON.parse 与前后缀比对；
// 切错边界 => 「仅动 POEMS」判据把结构改动看成没改（最贵的假绿）。

test('extractPoems：平铺数组精确返回 [...] 子串', () => {
  const src = '前缀 const POEMS = [{"id":1},{"id":2}] 后缀';
  assert.equal(extractPoems(src), '[{"id":1},{"id":2}]');
});

test('extractPoems：等号两侧无空格也认', () => {
  assert.equal(extractPoems('const POEMS=[1]'), '[1]');
});

test('extractPoems：嵌套数组按深度匹配，不在内层 ] 提前收口', () => {
  assert.equal(extractPoems('const POEMS = [[1,2],[3]]'), '[[1,2],[3]]');
});

test('extractPoems：字符串里的 ] 不算收口', () => {
  assert.equal(extractPoems('const POEMS = ["a]b"]'), '["a]b"]');
});

test('extractPoems：转义引号不提前出串（"] 藏在转义引号后仍要续读）', () => {
  const src = 'const POEMS = ["a\\"b]"]'; // 内容: "a\"b]" —— 串内有 ]，串以转义引号护住
  assert.equal(extractPoems(src), '["a\\"b]"]');
});

test('extractPoems：没有 POEMS → null', () => {
  assert.equal(extractPoems('let OTHER = [1]'), null);
});

test('extractPoems：未闭合 → null（宁可判结构异常，不返回半截）', () => {
  assert.equal(extractPoems('const POEMS = [1,2'), null);
});
