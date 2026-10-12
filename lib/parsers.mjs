// lib/parsers.mjs — 三颗手写迷你解析器（2026-10-12 从套件里抽出，F6）。
// 抽出的理由：selftest.mjs 要能不启动套件就给解析器喂边界样本单测；
// 套件本身保持"零依赖、无构建链"（node ESM 相对导入）。
// 这三颗是**唯一实现**——fleet-eval / merge-eval / selftest 共用这一份，不抄第二份。

// ── PowerShell 行级注释剥离 ────────────────────────────────────────────────
// PowerShell 的 `#` 注释必须先在行级剥掉，否则会读进被注释掉的旧端点
// （作者的 sync.ps1 里就留着一行被注释掉的旧端点 —— 已移出名单）。
// 实测踩过：不剥注释会凭空多出一端 codex/skills，240 条全报 ABSENT，纯假绿/假红。
export const stripPsComments = (s) => s.split(/\r?\n/).map((l) => { const i = l.indexOf('#'); return i < 0 ? l : l.slice(0, i); }).join('\n');

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
export function extractPoems(t) {
  const m = /const POEMS\s*=\s*\[/.exec(t);
  if (!m) return null;
  const st = m.index + m[0].length - 1;
  let i = st, depth = 0, inStr = false, esc = false;
  for (; i < t.length; i++) {
    const ch = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
    } else {
      if (ch === '"') inStr = true;
      else if (ch === "[") depth++;
      else if (ch === "]") { depth--; if (depth === 0) return t.slice(st, i + 1); }
    }
  }
  return null;
}
