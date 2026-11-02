// SPDX-License-Identifier: MIT
// lib/parsers.mjs — 三颗手写迷你解析器（2026-10-12 从套件里抽出，F6）。
// 抽出的理由：selftest.mjs 要能不启动套件就给解析器喂边界样本单测；
// 套件本身保持"零依赖、无构建链"（node ESM 相对导入）。
// 这三颗是**唯一实现**——fleet-eval / merge-eval / selftest 共用这一份，不抄第二份。

// ── PowerShell 行级注释剥离 ────────────────────────────────────────────────
// PowerShell 的 `#` 注释必须先在行级剥掉，否则会读进被注释掉的旧端点
// （作者的 sync.ps1 里就留着一行被注释掉的旧端点 —— 已移出名单）。
// 实测踩过：不剥注释会凭空多出一个端点 foo/skills，240 条全报 ABSENT，纯假绿/假红。
// 逐字符状态机：单双引号内的 # 是正文，不是注释；单引号用 '' 转义，双引号用反引号转义。
export const stripPsComments = (s) => s.split(/\r?\n/).map((line) => {
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote === "'") {
      if (ch === "'" && line[i + 1] === "'") { i++; continue; } // '' 是单引号内唯一的转义
      if (ch === "'") quote = null;
      continue;
    }
    if (quote === '"') {
      if (ch === '`') { i++; continue; } // 反引号转义下一个字符（含 " 与 #）
      if (ch === '"') quote = null;
      continue;
    }
    if (ch === '`') { i++; continue; } // 引号外反引号同样转义下一个字符
    if (ch === "'") { quote = "'"; continue; }
    if (ch === '"') { quote = '"'; continue; }
    if (ch === '#') return line.slice(0, i);
  }
  return line;
}).join('\n');

// ── 极简 frontmatter 解析：顶层 key: value，支持 >- / | 块标量 ──────────────────
export function parseFrontmatter(text) {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return null;
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') { end = i; break; }
  }
  if (end < 0) return null;
  const body = lines.slice(1, end);
  const out = {};
  for (let i = 0; i < body.length; i++) {
    const m = body[i].match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    // 重复 key 会让后值静默覆盖前值（name 唯一性检查因此失真），直接在写入前拒绝。
    if (Object.hasOwn(out, key)) throw new Error(`重复的 frontmatter key: ${key}`);
    let val = m[2].trim();
    if (val === '' || val === '>-' || val === '>' || val === '|' || val === '|-' || val === '>-') {
      const buf = [];
      while (i + 1 < body.length && /^\s+\S/.test(body[i + 1])) { buf.push(body[++i].trim()); }
      val = buf.join(' ').trim();
    }
    out[key] = val.replace(/^["']|["']$/g, '');
  }
  return out;
}

// ── 取 POEMS 数组文本（bracket 匹配，非正则偷懒）────────────────────────────
export function extractPoems(t, arrayName = 'POEMS') {
  const m = new RegExp('const ' + arrayName + '\\s*=\\s*\\[').exec(t);
  if (!m) return null;
  const st = m.index + m[0].length - 1;
  let i = st, depth = 0;
  while (i < t.length) {
    const ch = t[i];
    // 单引号 / 双引号 / 模板字符串：整段跳过，里面的 ] 不是数组边界。
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      i++;
      while (i < t.length) {
        if (t[i] === '\\') { i += 2; continue; }
        if (t[i] === quote) { i++; break; }
        i++;
      }
      continue;
    }
    // 行注释 / 块注释：整段跳过，里面的 ] 不是数组边界。
    if (ch === '/' && t[i + 1] === '/') {
      i += 2;
      while (i < t.length && t[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && t[i + 1] === '*') {
      i += 2;
      while (i < t.length && !(t[i] === '*' && t[i + 1] === '/')) i++;
      i = i + 2 > t.length ? t.length : i + 2;
      continue;
    }
    if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) return t.slice(st, i + 1);
    }
    i++;
  }
  return null;
}
