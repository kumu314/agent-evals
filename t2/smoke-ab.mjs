// SPDX-License-Identifier: MIT
// T2 技能 lift 冒烟 A/B
// 目的：验证「带技能 vs 不带技能」能否被区分出来 —— 只验管线，不追求统计功效。
// 设计：同一批任务跑两臂（control 无技能 / treated 带技能正文），确定性正则判分，不用 LLM 当裁判（不额外花钱）。
// 用法：
//   node smoke-ab.mjs --dry                     # 零调用：用预置答案证明判分管线有判别力
//   $env:T2_BASE_URL=...; $env:T2_API_KEY=...; $env:T2_MODEL=...
//   $env:T2_DISABLE_THINKING="1"   # 可选：混合思考模型（mimo 等）显式关思考，避开 60s 超时
//   node smoke-ab.mjs                           # 真跑
import fs from 'node:fs';
import path from 'node:path';

const BASE  = process.env.T2_BASE_URL;
const KEY   = process.env.T2_API_KEY;
const MODEL = process.env.T2_MODEL;
const TRIALS = Number(process.env.T2_TRIALS || 3);
const SKILL_ROOT = process.env.T2_SKILL_ROOT || path.join(import.meta.dirname, 'skills');
// 子集过滤：T2_TASK 逗号分隔任务 id；T2_ARM=control|treated|both（默认 both）
const ONLY_TASK = (process.env.T2_TASK || '').split(',').map((s) => s.trim()).filter(Boolean);
const ONLY_ARM = process.env.T2_ARM || 'both';
const DUMP = process.env.T2_DUMP === '1';
const DRY = process.argv.includes('--dry');

// ---- 任务集：每条任务自带确定性判据（全部命中才算过）----
// 设计原则：判据要落在「技能正文里有、裸模型答不到」的点上，否则两臂会撞天花板。
const TASKS = [
  {
    id: 'bad-advice-runtime',
    skill: 'runtime-resolution-and-abi',
    prompt: [
      '我这台 Windows 机器上，PATH 里有好几个 node。一个老同事给我留了张便条：',
      '',
      '> 「别折腾什么绝对路径，PATH 里那个 node 能跑就行，node 都互相兼容。」',
      '',
      '我要跑一个依赖 better-sqlite3 的命令行工具，他让我直接 `node tool.js` 就行。',
      '请判断：这张便条说的对吗？如果不对，错在哪？我该怎么确定该用哪个 node？',
      '只写你确实知道的；没把握的地方直说不确定，别顺着我的话说。',
    ].join('\n'),
    checks: [
      { name: '否定便条', re: /(不能互换|不可互换|不兼容|不一定兼容|版本[\s\S]{0,12}(不|冲突|不同|对不上)|NODE_MODULE_VERSION|abi|会报错|模块版本)/i },
      { name: '钉死手法', re: /(绝对路径|where\s+node|which\s+node|指定[\s\S]{0,8}node|钉死|pin)/i },
    ],
  },
  // ---- 候选（换掉天花板题用；probe 后再定去留）----
  {
    id: 'merge-verify-ritual',
    skill: 'silent-failure-triage',
    candidate: true,
    prompt: [
      '我在本地仓库用 `gh pr merge 42 --squash` 合并一个 PR。命令跑完退出码是 0，但一个字都没打印。',
      '我想确认到底合没合上，就接着跑了：',
      '',
      '```',
      'gh api repos/me/proj/pulls/42 --jq .state',
      '```',
      '',
      '输出是 `closed`。我印象里合并成功应该显示 `merged`，现在看到 `closed`，反而更不确定了。',
      '请判断：这个 PR 到底合上了没有？我该怎么确定地验证？',
      '只写你确实知道的；没把握的地方直说不确定，别顺着我的话说。',
    ].join('\n'),
    checks: [
      { name: '退出码0无信息', re: /(退出码\s*0[\s\S]{0,40}(不代表|不能说明|不携带|无信息|不可信|什么都没说|什么也说明不了)|成功时[\s\S]{0,12}(静默|不打印|没输出|一个字都不说))/ },
      { name: 'REST口径陷阱', re: /((REST|接口|API)[\s\S]{0,40}(closed|只有\s*open|没有\s*merged|永远不是\s*merged)|state[\s\S]{0,25}(只有|仅)[\s\S]{0,10}(open|closed))/i },
      { name: '正确复核', re: /(merged_at|merge_commit_sha|mergeCommit|MERGED|mergedAt)/i },
    ],
  },
  {
    id: 'guard-never-fires',
    skill: 'silent-failure-triage',
    candidate: true,
    prompt: [
      '我的启动脚本里有段守卫，想防止端口被占用时重复启动第二个实例：',
      '',
      '```',
      'netstat -ano | findstr /r /c:"LISTENING.*:8787"',
      '（命中就 exit）',
      '```',
      '',
      '实际跑起来端口 8787 确实被占着，但守卫没拦住，脚本还是起了第二个实例，',
      '最后 EADDRINUSE 退出了。',
      '请诊断：为什么这段守卫没生效？我该怎么修、怎么确认它真的会响？',
      '只写你确实知道的；没把握的地方直说不确定，别顺着我的话说。',
    ].join('\n'),
    checks: [
      { name: '列序根因', re: /(列序|列的顺序|顺序[\s\S]{0,12}(反|错|不对|颠倒)|状态[\s\S]{0,12}在[\s\S]{0,12}(端口|地址)[\s\S]{0,8}(之后|后面|后)|端口[\s\S]{0,8}在[\s\S]{0,8}状态[\s\S]{0,6}前)/ },
      { name: '恒假死代码', re: /(永远不(会)?(命中|成立|匹配)|恒假|不可能(成立|命中|匹配)|从没(触发|命中|生效)|死代码|形同虚设)/ },
    ],
  },
  {
    id: 'tautology-detector',
    skill: 'criterion-self-evidence-check',
    candidate: true,
    prompt: [
      '我写了个检测器，用来判断一批「记忆卡」是不是量产的模板：',
      '规则是——只要卡片文本里出现「每天慢读三遍」这句话，就判定它是模板。',
      '我拿一批卡跑了一遍，命中 40 条，看起来效果挺好，误伤也不多。',
      '',
      '请评审：这个检测器可靠吗？如果不可靠，问题在哪、我该怎么改？',
      '只写你确实知道的；没把握的地方直说不确定，别顺着我的话说。',
    ].join('\n'),
    checks: [
      { name: '硬编码脆弱', re: /(硬编码|写死|固定串|同义反复|自我满足|自证|循环|和生成器赛跑|赛跑|改一个字|改一个词)/i },
      { name: '换统计量', re: /(跨样本|跨篇|重复度|归一化|抹平|频次|不依赖措辞|统计量|统计方法)/i },
    ],
  },
  // ---- 第二批领域样例（v0.4.0 扩批：每臂 n 由 12 提到 24）----
  {
    id: 'changed-but-not-visible',
    skill: 'stale-output-layers',
    candidate: true,
    prompt: [
      '我在本地起了个 dev server 托管一个静态页，改动了 index.html 里的标题文字，然后重启了 server、也按了 Ctrl+F5 硬刷新，页面标题还是旧的。',
      '我怀疑是缓存没清干净，打算把浏览器缓存、Service Worker、server 的临时目录全清一遍再来一次。',
      '请判断：我"再清一遍缓存"的思路对吗？问题最可能出在哪，我该怎么定位？',
      '只写你确实知道的；没把握的地方直说不确定，别顺着我的话说。',
    ].join('\n'),
    checks: [
      { name: '身份非缓存', re: /(不是缓存|缓存解不了|根本没(进|被加载|被读)|加载[\s\S]{0,8}那份|服务[\s\S]{0,10}(的是|的另一)|进程[\s\S]{0,12}(启动|早于))/ },
      { name: '分层定位', re: /(哪一层|分层|逐层|相邻[\s\S]{0,4}层|构建产物|源码[\s\S]{0,6}产物|五层)/ },
      { name: '取证读数', re: /(标记串|加[\s\S]{0,6}(标记|个字|串)|哈希|mtime|时间戳|启动时间|读回|grep[\s\S]{0,8}产物)/ },
    ],
  },
  {
    id: 'stale-line-citation',
    skill: 'line-anchor-drift',
    candidate: true,
    prompt: [
      '我上周的代码复查报告里写「parser.js:88 有一处越界读」。今天同事在这个文件顶部加了两行 import，我去跳第 88 行，发现根本不是那条语句。',
      '同事说「第 88 行没问题，是你报告写错了」，我打算把报告里的 88 改成 90 交回去。',
      '请判断：同事说得对吗？我"改个行号交回去"的做法对不对？报告该怎么修？',
      '只写你确实知道的；没把握的地方直说不确定，别顺着我的话说。',
    ].join('\n'),
    checks: [
      { name: '行号不稳定', re: /(行号[\s\S]{0,12}(不稳定|会?漂移|会变|不可靠|一动[\s\S]{0,6}错|不是锚|位置引用))/ },
      { name: '改数字治标', re: /(改成 ?90[\s\S]{0,16}(又|再|下次)[\s\S]{0,8}(漂移|错)|治标|换个数字[\s\S]{0,8}(没用|白做|还会)|只是把[\s\S]{0,12}往后)/ },
      { name: '换内容锚', re: /(文本锚|稳定锚|原文片段|逐字|grep|按(内容|文本)定位|可[\s\S]{0,4}命中)/ },
    ],
  },
  {
    id: 'hash-mismatch-invisible',
    skill: 'text-encoding-forensics',
    candidate: true,
    prompt: [
      '同一份 config.txt，我在 Windows 上算的 sha256 和 CI（Linux）上算的不一样。把两个文件都打开逐字看，内容完全相同。',
      '我怀疑是传输过程中文件被改坏了，正打算重新敲一遍内容再算哈希，好让两边对上。',
      '请判断：「内容完全相同却哈希不同」该怎么解释？我重新敲内容的思路对不对？该怎么做？',
      '只写你确实知道的；没把握的地方直说不确定，别顺着我的话说。',
    ].join('\n'),
    checks: [
      { name: '不可见字节', re: /(不可见|看不见[\s\S]{0,4}字节|BOM|CRLF|行尾|换行符|尾随|字节[\s\S]{0,6}(不同|差|不一致))/ },
      { name: 'hexdump取证', re: /(hexdump|xxd|cmp |od -|十六进制|字节[\s\S]{0,6}(比对|对比|看))/ },
      { name: 'diff会漏', re: /(diff[\s\S]{0,20}(忽略|看不出|发现不了|看不见|漏|无差异)|文本[\s\S]{0,8}工具[\s\S]{0,10}(忽略|看不出|漏))/ },
    ],
  },
  {
    id: 'push-hung-recheck',
    skill: 'git-push-fake-timeout',
    candidate: true,
    prompt: [
      '我 git push 到 origin main，终端卡了三分多钟一点输出都没有，我按了 Ctrl-C 中断。我以为没推上去，又跑了一次 push，这次秒回，显示 Everything up-to-date。',
      '我现在的结论是：第一次肯定失败了，第二次 up-to-date 说明远端压根没收到我的提交，得想办法强制再推一次。',
      '请判断：我这个结论对吗？到底推上去没有，我该怎么确定？',
      '只写你确实知道的；没把握的地方直说不确定，别顺着我的话说。',
    ].join('\n'),
    checks: [
      { name: '中断不等于失败', re: /(卡[\s\S]{0,8}不一定[\s\S]{0,6}失败|中断[\s\S]{0,12}(不等|不代表|未必|不等于)[\s\S]{0,8}失败|超时[\s\S]{0,10}(不代表|未必|不等于|丢的是回执)|可能[\s\S]{0,8}(成功|完成|推上去了)|已经[\s\S]{0,8}(更新|完成))/ },
      { name: '认远端读数', re: /(ls-remote|rev-parse[\s\S]{0,8}HEAD|远端[\s\S]{0,12}(sha|ref|读数|对比|比|指到)|git\s+fetch|origin\/)/ }, // v2 2026-10-17: also credit git fetch / origin/<br> (remote-tracking) — same remote-truth concept; old rule only credited ls-remote => false-negative on valid control answers
      { name: '不信自述', re: /(退出码|回执|up-to-date[\s\S]{0,24}(不携带|不足以|不能|本身|只是)|这句话[\s\S]{0,8}不)/ },
    ],
  },
];

// ---- 两臂的系统提示 ----
function systemFor(arm, skillName, skillText) {
  const base = '你是一个严谨的技术助手，回答用中文。';
  if (arm === 'control') return base;
  return base + '\n\n下面是你可用的技能，请遵循其中的检查项：\n\n<skill name="' + skillName + '">\n' + skillText + '\n</skill>';
}

const _skillCache = new Map();
function loadSkill(name) {
  if (_skillCache.has(name)) return _skillCache.get(name);
  const p = path.join(SKILL_ROOT, name, 'SKILL.md');
  if (!fs.existsSync(p)) throw new Error('技能不存在: ' + p);
  const t = fs.readFileSync(p, 'utf8');
  _skillCache.set(name, t);
  return t;
}

function score(answer, task) {
  const hits = task.checks.filter((c) => c.re.test(answer)).map((c) => c.name);
  return { passed: hits.length === task.checks.length, hits, total: task.checks.length };
}

async function askOnce(system, user) {
  // 上游会挂住不返回（实测 >150s 无响应），必须自带超时，否则整轮挂死
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 60000);
  let r;
  try {
    r = await fetch(BASE.replace(/\/$/, '') + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + KEY },
      body: JSON.stringify({
        model: MODEL,
        messages: [ { role: 'system', content: system }, { role: 'user', content: user } ],
        temperature: 0,
        // 混合思考模型（如 mimo-v2.6-flash）默认开思考：首 token 延迟高、单次可超 60s 撞上面的超时。
        // T2_DISABLE_THINKING=1 显式关闭（官方 OpenAI 兼容参数 thinking.type）；其他 provider 不带此参数，行为不变。
        ...(process.env.T2_DISABLE_THINKING === '1' ? { thinking: { type: 'disabled' } } : {}),
      }),
      signal: ctl.signal,
    });
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('timeout：60s 无响应（上游挂住）');
    throw e;
  } finally {
    clearTimeout(timer);
  }
  const raw = await r.text();
  if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + raw.slice(0, 500));
  let j;
  try { j = JSON.parse(raw); } catch { throw new Error('非 JSON 响应: ' + raw.slice(0, 300)); }
  const msg = j.choices?.[0]?.message;
  const content = msg?.content;
  if (typeof content !== 'string' || content.length === 0) {
    // 模型可能返回工具调用而非文本（技能正文诱导"先去执行"）——这是可记录的现象，不是可重试的抖动
    const tc = msg?.tool_calls;
    if (Array.isArray(tc) && tc.length) {
      const e = new Error('TOOLCALL：返回工具调用而非文本（' + tc.map((x) => x.function?.name).join(',') + '）');
      e.toolCall = true;
      throw e;
    }
    // 空答案一律当错误抛出：静默返回 '' 会把「调用失败」伪装成「技能没用」
    throw new Error('空 content；finish_reason=' + j.choices?.[0]?.finish_reason +
      '；raw=' + JSON.stringify(j).slice(0, 600));
  }
  return content;
}

// 免费档上游常 503/限流 —— 瞬时错误退避重试，重试耗尽才当失败
async function ask(system, user, attempt = 1) {
  try {
    return await askOnce(system, user);
  } catch (e) {
    if (e.toolCall) throw e; // 工具调用不是抖动，重试无用
    const transient = /503|overloaded|429|rate|timeout|ECONN|fetch failed|ETIMEDOUT/i.test(e.message);
    if (transient && attempt <= 4) {
      const wait = 2000 * attempt;
      console.error(`  (transient: ${e.message.slice(0, 70)} — ${wait}ms 后重试 ${attempt}/4)`);
      await new Promise((res) => setTimeout(res, wait));
      return ask(system, user, attempt + 1);
    }
    throw e;
  }
}

// ---- dry 模式：每条任务预置两段答案，坏的一臂只答表象、好的一臂答到全部判据 ----
const DRY_ANSWERS = {
  'bad-advice-runtime': {
    control: '便条说得对，PATH 里的 node 能跑就行，node 各版本基本互相兼容，直接 `node tool.js` 没问题。',
    treated: '这张便条不对。node 之间并不兼容：原生模块按 NODE_MODULE_VERSION 编译，装了 better-sqlite3 的机器如果 node 大版本不同，加载时会报模块版本对不上（NODE_MODULE_VERSION mismatch）。别只靠 PATH 里第一个 node，用 `where node` 看清有哪些，再用绝对路径钉死你要的那个 node。',
  },
  'merge-verify-ritual': {
    control: '退出码 0 说明合并命令执行成功了，但 `closed` 表示 PR 只是被关闭了、并没有合并。建议改用 `--merge` 参数重试一次。',
    treated: '退出码 0 不代表合并成功——`gh pr merge` 成功时本来就不打印任何东西，退出码 0 不携带信息。你看到的 `closed` 是 REST 接口的口径陷阱：REST 的 state 只有 open / closed 两个值，永远不会是 merged，所以拿它去比 merged 是恒假判据。要确定就查 merged_at 与 merge_commit_sha（或 GraphQL 的 state=MERGED），并看 base 分支有没有真前进。',
  },
  'guard-never-fires': {
    control: '守卫没生效应该是 findstr 的正则转义写错了，或者 netstat 的输出被别的行干扰了。建议改用 PowerShell 的 Get-NetTCPConnection 来查端口。',
    treated: '根因是列序理解反了：netstat 的列是「本地地址:端口 … 远端地址 状态」，状态在端口之后，所以 `LISTENING.*:8787` 这个先后顺序永远不可能成立——守卫条件恒假，是死代码，从不触发。修法是改用不依赖顺序和本地化词的判据（本地端口 + 远端 0.0.0.0:0），并且拿一个必然命中的输入和一个必然不命中的输入正反两侧各验一次。',
  },
  'tautology-detector': {
    control: '检测器基本可用，命中 40 条说明规则有效。建议把匹配串做成配置项方便维护。',
    treated: '不可靠。这是硬编码串检测，等于和生成器赛跑：生成器改一个字（慢读→读）就失效，而且不会报错，你只会看到命中数变少。要改就换成不依赖措辞的统计量，比如抹平专有名词后统计跨样本重复度。',
  },
  'changed-but-not-visible': {
    control: '多半就是缓存没清干净，把浏览器缓存和 Service Worker 全清掉、再重启 server 基本就好了，实在不行换个无痕窗口再试一次。',
    treated: '先别急着清缓存。改了却看不到，几乎唯一的原因是：你看的不是承载改动的那一层——很可能是 dev server 根本没加载你改的那份 index.html（服务的是另一份或旧构建产物），这是身份问题不是缓存问题，清缓存解决不了。按分层定位：拿一个只存在于新改动里的标记串去 grep 产物，产物里没有就说明卡在加载那份；产物里有、页面上没有才是渲染层。再把进程启动时间和文件 mtime 比一比，进程早于改动就永远看不到新内容。每清一层立刻验一次，别三管齐下。',
  },
  'stale-line-citation': {
    control: '同事说得对，第 88 行确实没问题，是你当时数错了行号。把报告里的 88 改成 90 重新数一遍核对下就好。',
    treated: '你俩都没记错——行号是不稳定锚，前面一加两行，后面所有行号整体漂移，第 88 跳到别处是必然的，不是谁写错。把 88 改成 90 是治标：下次再有人在前面插一行，90 又错了。正确修法是把位置引用换成内容锚——报告里附上那条语句一段能逐字命中的原文，用 grep 它来定位，行号只当便利跳转并标注会漂。交付前对每条引用 grep 一遍：原文还在就重算行号，原文也搜不到才说明结论要改。',
  },
  'hash-mismatch-invisible': {
    control: '内容看起来一样哈希却不同，那基本就是文件在传输里被改动或损坏了，重新敲一遍内容、存一次再算哈希，两边应该就对上了。',
    treated: '别急着重敲内容。逐字看相同却哈希不同，最常见不是内容变了，而是肉眼看不见的字节差异：UTF-8 的 BOM（开头 EF BB BF）、行尾符 CRLF 与 LF、或编码不同。文本 diff 工具常常忽略行尾和 BOM，所以 diff 说没差异、哈希却不同，恰恰是线索——问题在被忽略那层。正确取证：cmp fileA fileB 看第一个不同的字节偏移，再用 xxd 看首尾字节，确认是 BOM/行尾还是真内容，然后对症去 BOM、统一 eol=lf，而不是重敲内容去凑哈希。',
  },
  'push-hung-recheck': {
    control: '第一次卡住没输出就是失败了，第二次显示 Everything up-to-date 证明远端根本没收到，你判断没错——直接强制再 push 一次。',
    treated: '先别强制重推。push 客户端卡住、被 Ctrl-C 中断，丢的往往只是那条回执，数据很可能已经到服务端、ref 已经更新——客户端超时不等于传输失败。判成没成要问远端：git ls-remote origin main 读到的 sha 和 git rev-parse HEAD 比一比，相等就说明第一次其实推上去了，第二次 Everything up-to-date 恰恰是确实成了的真告、不要再推；只有两者不等才说明没成、可安全重试。别拿退出码和 up-to-date 这句话当判据，它不携带远端等于哪个 sha 的信息。',
  },
};

async function run() {
  const activeTasks = ONLY_TASK.length ? TASKS.filter((t) => ONLY_TASK.includes(t.id)) : TASKS;
  const arms = ONLY_ARM === 'both' ? ['control', 'treated'] : [ONLY_ARM];
  const rows = [];
  for (const task of activeTasks) {
    const skillText = DRY ? '(dry-run 不读技能正文)' : loadSkill(task.skill);
    for (const arm of arms) {
      for (let t = 1; t <= TRIALS; t++) {
        let ans, err = null;
        if (DRY) ans = DRY_ANSWERS[task.id][arm];
        else {
          try { ans = await ask(systemFor(arm, task.skill, skillText), task.prompt); }
          catch (e) { err = e; }
        }
        if (err) {
          const kind = err.toolCall ? 'TOOLCALL' : 'ERROR';
          if (DUMP) console.log('\n===== ' + task.id + ' / ' + arm + ' / t' + t + ' ===== [' + kind + '] ' + err.message.slice(0, 120) + '\n');
          rows.push({ task: task.id, arm, trial: t, passed: false, hits: [], chars: 0, err: kind, msg: err.message.slice(0, 90) });
          continue;
        }
        const s = score(ans, task);
        if (DUMP) console.log('\n===== ' + task.id + ' / ' + arm + ' / t' + t + ' =====\n' + ans + '\n');
        rows.push({ task: task.id, arm, trial: t, passed: s.passed, hits: s.hits, chars: ans.length });
      }
    }
  }
  // 汇总：有效率只算"拿到了文本答案"的调用；工具调用/报错单列，不混进通过率
  const by = (arm) => rows.filter((r) => r.arm === arm);
  const valid = (arm) => by(arm).filter((r) => !r.err);
  const rate = (arm) => { const a = valid(arm); return a.length ? a.filter((r) => r.passed).length / a.length : 0; };
  console.log('provider = ' + (DRY ? 'DRY (零调用)' : `${MODEL} @ ${BASE}`));
  console.log('tasks    = ' + activeTasks.map((t) => t.id + '(' + t.skill + ')').join(', ') + '   trials/arm = ' + TRIALS + '   arms = ' + arms.join('+'));
  console.log('-'.repeat(72));
  for (const r of rows) {
    const status = r.err ? r.err : (r.passed ? 'PASS' : 'FAIL');
    console.log(`[${r.arm.padEnd(7)}] ${r.task.padEnd(18)} t${r.trial}  ${status.padEnd(8)}  ${r.hits.join(',') || (r.err ? r.msg : '(无命中)')}  ${r.chars}c`);
  }
  console.log('-'.repeat(72));
  for (const arm of arms) {
    const e = by(arm).filter((r) => r.err);
    const tc = e.filter((r) => r.err === 'TOOLCALL').length;
    const er = e.filter((r) => r.err === 'ERROR').length;
    const a = valid(arm);
    console.log(`${arm.padEnd(7)} 有效 ${a.length}/${by(arm).length}（通过 ${a.filter((r) => r.passed).length}）  工具调用 ${tc}  报错 ${er}`);
  }
  const c = rate('control'), t = rate('treated');
  console.log(`control pass = ${(c * 100).toFixed(0)}%    treated pass = ${(t * 100).toFixed(0)}%    lift = ${((t - c) * 100).toFixed(0)} 个百分点`);
  const anyErr = rows.some((r) => r.err);
  console.log(t - c > 0
    ? '=> 两臂可区分（管线有判别力）'
    : (DRY ? '=> dry 两臂不可区分：判据或预置答案有问题，先修'
      : (anyErr ? '=> 两臂未拉开（本轮存在工具调用/报错，读数不完整，先看上方分布）' : '=> 本任务上两臂未拉开：换更贴技能的任务，或加 trial')));
  return { c, t };
}

run().catch((e) => { console.error('ERROR: ' + e.message); process.exit(1); });