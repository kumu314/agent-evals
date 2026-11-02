// SPDX-License-Identifier: MIT
// T2 唯一判分入口：执行器不再自带第二套判分逻辑，通过与否只在这里决定。

// 判据 id 默认由 task.id + check.name 派生，保证同一判据在 manifest 里可稳定追溯。
export function criterionId(task, criterion) {
  return criterion.id ?? `${task.id}/${criterion.name}`;
}

function snapshotItem(task, item) {
  return {
    id: criterionId(task, item),
    name: item.name,
    source: item.re.source,
    flags: item.re.flags,
  };
}

export function criteriaSnapshot(task) {
  return {
    checks: (task.checks ?? []).map((item) => snapshotItem(task, item)),
    forbid: (task.forbid ?? []).map((item) => snapshotItem(task, item)),
  };
}

export function score(answer, task) {
  const text = typeof answer === 'string' ? answer : '';
  const checks = task.checks ?? [];
  const hits = checks.filter((item) => item.re.test(text)).map((item) => item.name);
  const forbidHits = (task.forbid ?? []).filter((item) => item.re.test(text)).map((item) => item.name);
  return {
    passed: hits.length === checks.length && forbidHits.length === 0,
    hits,
    forbidHits,
    total: checks.length,
  };
}
