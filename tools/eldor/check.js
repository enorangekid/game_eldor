#!/usr/bin/env node
// 엘도르 연대기 스크립트 검사기.
//
//   node tools/eldor/check.js                 기본 대상(프롤로그 → 1막) 검사
//   node tools/eldor/check.js 파일.md …        지정한 파일만 (막 순서대로 적는다)
//   node tools/eldor/check.js --quiet         참고(info)는 빼고 오류·주의만
//   node tools/eldor/check.js --json          결과를 JSON으로
//
// 오류가 하나라도 있으면 종료 코드 1.
//
// 검사 항목
//   오류: 장면 ID 중복 · 없는 장면으로 이동 · 다음 장면이 없는 장면 · [if]/[else]/[end] 짝
//         · 한 번도 정해지지 않은 변수를 조건에서 읽음
//   주의: 시작에서 닿을 수 없는 장면 · 이동 없이 흘러내리는 선택지 · 선택지가 하나뿐
//         · 조건에서 비교하는 값을 어디서도 넣지 않음 · 절대 참이 될 수 없는 숫자 조건
//         · '진입'에 적힌 장면이 실제로는 이리로 오지 않음 · '넘어오는 변수'가 앞 막에 없음
//   참고: 정해 놓고 읽지 않는 변수 · 기본값 선언이 없는 변수 · '= 값' 비교인데 값이 더 커질 수 있음
//         · 다음 막에서 읽지만 '넘어오는 변수' 목록에 없음 · 열린 끝(원고 없음)

'use strict';

const { loadProject } = require('./parse.js');

const LEVEL_NAME = { error: '오류', warn: '주의', info: '참고' };

function analyze(project) {
  const issues = [];
  const add = (level, file, line, scene, msg, extra) =>
    issues.push({ level, file, line, scene: scene || null, msg, ...(extra || {}) });

  // 파싱 단계 문제
  for (const f of project.files) for (const p of f.problems) add(p.level, p.file, p.line, p.scene, p.msg);

  // ── 장면 그래프 ─────────────────────────────────────────────
  const scenes = [];
  const byId = new Map();
  project.files.forEach((f, fileIndex) => {
    for (const s of f.scenes) {
      s.fileIndex = fileIndex;
      if (byId.has(s.id)) {
        const first = byId.get(s.id);
        add('error', s.file, s.line, s.id, `장면 ID ${s.id}가 중복됩니다 (처음: ${first.file}:${first.line})`);
        continue;
      }
      byId.set(s.id, s);
      scenes.push(s);
    }
  });

  const edges = [];      // {from, to, label, cond, line}
  const openEnds = [];   // {from, text, line}
  for (const s of scenes) {
    if (!s.jumps.length) add('error', s.file, s.endLine || s.line, s.id, `${s.id}에서 다음 장면으로 가는 ⇒ 이동이 없습니다`);
    for (const j of s.jumps) {
      if (!j.to) { openEnds.push({ from: s.id, text: j.text, line: j.line }); continue; }
      if (!byId.has(j.to)) { add('error', s.file, j.line, s.id, `없는 장면 ${j.to}(으)로 이동합니다`); continue; }
      let label = '';
      if (j.choice !== null && j.option !== null) {
        const c = s.choices[j.choice];
        label = `${c.options.length > 1 ? j.option : ''}`;
      }
      edges.push({ from: s.id, to: j.to, label, option: j.option, choice: j.choice,
        cond: j.cond.map(condText).join(' · '), line: j.line });
    }
  }
  for (const o of openEnds) {
    const s = byId.get(o.from);
    add('info', s.file, o.line, s.id, `열린 끝: ${o.text}`);
  }

  // 중복 간선 합치기 (같은 from→to, 라벨 모음)
  const merged = new Map();
  for (const e of edges) {
    const k = e.from + '>' + e.to;
    if (!merged.has(k)) merged.set(k, { from: e.from, to: e.to, labels: [], conds: [], lines: [] });
    const m = merged.get(k);
    if (e.label) m.labels.push(e.label);
    if (e.cond) m.conds.push(e.cond);
    m.lines.push(e.line);
  }
  const graphEdges = [...merged.values()];
  const preds = new Map(scenes.map(s => [s.id, []]));
  const succs = new Map(scenes.map(s => [s.id, []]));
  for (const e of graphEdges) { preds.get(e.to).push(e.from); succs.get(e.from).push(e.to); }

  // 도달 가능성
  const entry = scenes.length ? scenes[0].id : null;
  const reach = new Set();
  if (entry) {
    const q = [entry];
    reach.add(entry);
    while (q.length) for (const n of succs.get(q.shift())) if (!reach.has(n)) { reach.add(n); q.push(n); }
  }
  for (const s of scenes) if (!reach.has(s.id)) add('warn', s.file, s.line, s.id, `시작(${entry})에서 ${s.id}에 닿는 경로가 없습니다`);

  // '진입' 정보와 실제 들어오는 장면 비교
  for (const s of scenes) {
    const entryText = s.meta['진입'];
    if (!entryText) continue;
    const named = [...entryText.matchAll(/[A-Z][A-Z0-9]*-\d+[A-Z]?/g)].map(m => m[0]);
    // 'P-12A / B / C' 같은 줄임 표기 펼치기
    const short = entryText.match(/([A-Z][A-Z0-9]*-\d+)([A-Z])((?:\s*\/\s*[A-Z])+)/);
    if (short) for (const m of short[3].matchAll(/[A-Z]/g)) named.push(short[1] + m[0]);
    for (const id of new Set(named)) {
      if (!byId.has(id)) add('warn', s.file, s.line, s.id, `'진입'에 적힌 ${id}가 없는 장면입니다`);
      else if (!preds.get(s.id).includes(id)) add('warn', s.file, s.line, s.id, `'진입'에는 ${id}라고 적혀 있지만 ${id}에서 ${s.id}로 오는 ⇒가 없습니다`);
    }
  }

  // 선택지 구조
  for (const s of scenes) {
    s.choices.forEach((c, ci) => {
      if (c.kind !== '선택') return;
      if (c.options.length < 2) add('warn', s.file, c.line, s.id, `선택지 '${c.title || '(제목 없음)'}'의 보기가 ${c.options.length}개뿐입니다`);
      const lastOptLine = c.options.length ? c.options[c.options.length - 1].line : c.line;
      // 선택지 뒤, 같은 조건 깊이 이하에서 조건 없이 나오는 이동이 있으면 흘러내려도 괜찮다
      const tail = s.jumps.some(j => j.line > lastOptLine && j.choice === null && j.cond.length <= c.cond.length);
      for (const o of c.options) {
        if (!o.jump && !tail) add('warn', s.file, o.line, s.id, `선택지 '${c.title}' ${o.n}번 보기 뒤에 ⇒ 이동이 없고, 선택지 뒤에도 이어지는 이동이 없습니다`);
      }
    });
  }

  // ── 변수 ───────────────────────────────────────────────────
  const vars = new Map();   // name → {defaults:[], sets:[], reads:[], values:Set, numeric:bool}
  const V = name => {
    if (!vars.has(name)) vars.set(name, { name, defaults: [], sets: [], reads: [], carried: [] });
    return vars.get(name);
  };
  project.files.forEach((f, fi) => {
    for (const [name, d] of Object.entries(f.defaults)) V(name).defaults.push({ file: f.file, fileIndex: fi, line: d.line, value: d.value });
    for (const c of f.carried) V(c.var).carried.push({ file: f.file, fileIndex: fi, line: c.line });
  });
  for (const s of scenes) {
    for (const x of s.sets) V(x.var).sets.push({ ...x, scene: s.id, file: s.file, fileIndex: s.fileIndex });
    for (const x of s.reads) V(x.var).reads.push({ ...x, scene: s.id, file: s.file, fileIndex: s.fileIndex });
  }

  for (const v of vars.values()) {
    const assigned = [...v.defaults.map(d => d.value), ...v.sets.filter(x => x.op === '=').map(x => x.value)];
    v.numeric = assigned.some(a => typeof a === 'number') || v.sets.some(x => x.op !== '=');
    v.values = [...new Set(assigned.map(String))];
    v.kind = v.numeric ? 'number' : (assigned.every(a => typeof a === 'boolean') && assigned.length ? 'bool' : 'text');

    const firstRead = v.reads[0];
    if (v.reads.length && !v.sets.length && !v.defaults.length) {
      for (const r of v.reads) add('error', r.file, r.line, r.scene, `\`${v.name}\`을(를) 조건에서 읽지만 어디서도 값을 정하지 않습니다`);
      continue;
    }
    if (!v.reads.length && (v.sets.length || v.defaults.length)) {
      const at = v.sets[0] || v.defaults[0];
      add('info', at.file, at.line, at.scene, `\`${v.name}\`은(는) 정해 놓고 아직 어디서도 읽지 않습니다 (다음 막에서 쓸 예정이면 무시)`, { var: v.name });
    }
    if (!v.defaults.length && v.sets.length) {
      const at = v.sets[0];
      add('info', at.file, at.line, at.scene, `\`${v.name}\`의 기본값 선언이 없습니다 (Ren'Py에서는 default가 필요)`, { var: v.name, group: 'nodefault' });
    }
    // 비교하는 값이 들어온 적 있는가 (숫자가 아닌 변수)
    if (!v.numeric) {
      for (const r of v.reads) {
        if (!v.values.includes(String(r.value))) {
          add('warn', r.file, r.line, r.scene, `\`${v.name}\` ${r.op} ${r.value} 를 비교하지만, \`${v.name}\`에 ${r.value} 값을 넣는 곳이 없습니다 (들어가는 값: ${v.values.join(', ') || '없음'})`);
        }
      }
    }
    // '넘어오는 변수'
    for (const c of v.carried) {
      const before = v.defaults.some(d => d.fileIndex < c.fileIndex) || v.sets.some(x => x.fileIndex < c.fileIndex);
      if (!before) add('warn', c.file, c.line, null, `'넘어오는 변수'에 \`${v.name}\`이 있지만 앞 막에서 정하지 않습니다`);
    }
    // 앞 막에서 정한 변수를 다음 막에서 읽는데 목록에 없음
    const readFiles = [...new Set(v.reads.map(r => r.fileIndex))];
    for (const fi of readFiles) {
      if (fi === 0) continue;
      const fromBefore = v.defaults.some(d => d.fileIndex < fi) || v.sets.some(x => x.fileIndex < fi);
      const declaredHere = v.defaults.some(d => d.fileIndex === fi) || v.carried.some(c => c.fileIndex === fi);
      if (fromBefore && !declaredHere) {
        const r = v.reads.find(x => x.fileIndex === fi);
        add('info', r.file, r.line, r.scene, `\`${v.name}\`은(는) 앞 막에서 넘어오는 변수인데, 이 파일 머리말 '넘어오는 변수' 목록에 없습니다`, { var: v.name });
      }
    }
  }

  // ── 숫자 변수 범위 (경로를 따라 최소·최대) ─────────────────
  const order = topoOrder(scenes, preds, succs);
  const numericVars = [...vars.values()].filter(v => v.numeric);
  const boundsIn = new Map();   // sceneId → {var: [min,max]}
  const boundsOut = new Map();
  const startBounds = {};
  for (const v of numericVars) {
    const d = v.defaults.length ? v.defaults[0].value : 0;
    startBounds[v.name] = typeof d === 'number' ? [d, d] : [0, 0];
  }
  for (const id of order) {
    const s = byId.get(id);
    const ps = preds.get(id).filter(p => boundsOut.has(p));
    let b;
    if (!ps.length) b = clone(startBounds);
    else {
      b = {};
      for (const v of numericVars) {
        const rs = ps.map(p => boundsOut.get(p)[v.name]);
        b[v.name] = [Math.min(...rs.map(r => r[0])), Math.max(...rs.map(r => r[1]))];
      }
    }
    boundsIn.set(id, b);
    // 장면 안의 읽기는 그 줄보다 앞선 변경까지 반영해 판단
    for (const r of s.reads) {
      const v = vars.get(r.var);
      if (!v || !v.numeric || typeof r.value !== 'number') continue;
      const [lo, hi] = applySets(b[r.var], s, r.var, r.line);
      checkNumericRead(add, s, r, lo, hi);
    }
    const out = {};
    for (const v of numericVars) out[v.name] = applySets(b[v.name], s, v.name, Infinity);
    boundsOut.set(id, out);
  }

  // 정렬: 파일 순서 → 줄 → 수준
  const rank = { error: 0, warn: 1, info: 2 };
  const fileOrder = new Map(project.files.map((f, i) => [f.file, i]));
  issues.sort((a, b) => rank[a.level] - rank[b.level]
    || (fileOrder.get(a.file) ?? 99) - (fileOrder.get(b.file) ?? 99) || (a.line || 0) - (b.line || 0));

  return {
    files: project.files.map(f => ({ file: f.file, defaults: f.defaults, carried: f.carried })),
    entry,
    scenes: scenes.map(s => ({
      id: s.id, title: s.title, level: s.level, file: s.file, fileIndex: s.fileIndex, line: s.line, endLine: s.endLine,
      chapter: s.chapter, meta: s.meta, notes: s.notes, lines: s.lines,
      choices: s.choices, sets: s.sets, reads: s.reads, invests: s.invests,
      reachable: reach.has(s.id),
      bounds: boundsIn.get(s.id) || null,
    })),
    edges: graphEdges,
    openEnds,
    vars: [...vars.values()].map(v => ({
      name: v.name, kind: v.kind, values: v.values,
      defaults: v.defaults, carried: v.carried,
      sets: v.sets.map(x => ({ scene: x.scene, line: x.line, op: x.op, value: x.value, option: x.option, cond: x.cond.map(condText).join(' · ') })),
      reads: v.reads.map(x => ({ scene: x.scene, line: x.line, op: x.op, value: x.value })),
    })).sort((a, b) => a.name.localeCompare(b.name)),
    issues,
  };
}

function condText(c) { return `${c.branch === 'else' ? '아니면 ' : ''}${c.var} ${c.op} ${c.value}`; }
function clone(o) { return JSON.parse(JSON.stringify(o)); }

// 장면 안 변경을 범위에 반영. 선택지 보기끼리는 서로 배타적이라 보기별 변화의 최소·최대를 쓴다.
function applySets(range, scene, name, beforeLine) {
  let [lo, hi] = range;
  const sets = scene.sets.filter(x => x.var === name && x.line < beforeLine);
  if (!sets.length) return [lo, hi];
  const byChoice = new Map();
  const plain = [];
  for (const x of sets) {
    if (x.choice !== null && x.option !== null) {
      const k = x.choice;
      if (!byChoice.has(k)) byChoice.set(k, new Map());
      const m = byChoice.get(k);
      m.set(x.option, (m.get(x.option) || []).concat(x));
    } else plain.push(x);
  }
  const delta = x => (x.op === '+' ? x.value : x.op === '-' ? -x.value : null);
  for (const x of plain) {
    if (x.op === '=') {
      if (x.cond.length || x.conditional) { lo = Math.min(lo, x.value); hi = Math.max(hi, x.value); }
      else { lo = hi = x.value; }
      continue;
    }
    const d = delta(x);
    if (x.cond.length || x.conditional) { lo += Math.min(0, d); hi += Math.max(0, d); }
    else { lo += d; hi += d; }
  }
  for (const [ci, optMap] of byChoice) {
    const choice = scene.choices[ci];
    const optionCount = choice ? choice.options.length : optMap.size;
    const ds = [];
    for (const list of optMap.values()) {
      let d = 0, fixed = null;
      for (const x of list) { if (x.op === '=') fixed = x.value; else d += delta(x); }
      ds.push(fixed !== null ? { fixed, d } : { d });
    }
    // 변경이 없는 보기도 있을 수 있다
    if (optMap.size < optionCount) ds.push({ d: 0 });
    const los = ds.map(o => (o.fixed !== undefined ? o.fixed + o.d : lo + o.d));
    const his = ds.map(o => (o.fixed !== undefined ? o.fixed + o.d : hi + o.d));
    const anyCond = [...optMap.values()].flat().some(x => x.cond.length);
    lo = Math.min(...los, anyCond ? lo : Infinity);
    hi = Math.max(...his, anyCond ? hi : -Infinity);
  }
  return [lo, hi];
}

function checkNumericRead(add, s, r, lo, hi) {
  const v = r.value;
  const never = (r.op === '=' && (v < lo || v > hi)) || (r.op === '≥' && v > hi) || (r.op === '>' && v >= hi)
    || (r.op === '≤' && v < lo) || (r.op === '<' && v <= lo);
  const always = (r.op === '≥' && v <= lo) || (r.op === '≤' && v >= hi) || (r.op === '≠' && (v < lo || v > hi));
  if (never) add('warn', s.file, r.line, s.id, `[if \`${r.var}\` ${r.op} ${v}] 는 이 시점에 참이 될 수 없습니다 (가능한 범위 ${lo}~${hi})`, { var: r.var });
  else if (always && lo !== hi) add('info', s.file, r.line, s.id, `[if \`${r.var}\` ${r.op} ${v}] 는 이 시점에 항상 참입니다 (가능한 범위 ${lo}~${hi})`, { var: r.var });
  else if (r.op === '=' && hi > v) add('info', s.file, r.line, s.id, `[if \`${r.var}\` = ${v}] — 이 시점에 \`${r.var}\`이(가) ${hi}까지 될 수 있습니다. ${v}보다 큰 경우를 빼려는 게 아니면 ≥ 를 검토하세요`, { var: r.var });
}

function topoOrder(scenes, preds, succs) {
  const indeg = new Map(scenes.map(s => [s.id, preds.get(s.id).length]));
  const q = scenes.filter(s => indeg.get(s.id) === 0).map(s => s.id);
  const out = [];
  const seen = new Set();
  while (q.length) {
    const n = q.shift();
    if (seen.has(n)) continue;
    seen.add(n); out.push(n);
    for (const m of succs.get(n)) { indeg.set(m, indeg.get(m) - 1); if (indeg.get(m) === 0) q.push(m); }
  }
  for (const s of scenes) if (!seen.has(s.id)) out.push(s.id);   // 순환에 걸린 장면은 파일 순서대로
  return out;
}

function printReport(result, opts) {
  const counts = { error: 0, warn: 0, info: 0 };
  for (const i of result.issues) counts[i.level]++;
  const out = [];
  out.push(`엘도르 스크립트 검사 — 파일 ${result.files.length}개 · 장면 ${result.scenes.length}개 · 이동 ${result.edges.length}개 · 변수 ${result.vars.length}개`);
  out.push(`오류 ${counts.error} · 주의 ${counts.warn} · 참고 ${counts.info}`);
  for (const level of ['error', 'warn', 'info']) {
    if (opts.quiet && level === 'info') continue;
    let list = result.issues.filter(i => i.level === level);
    if (!list.length) continue;
    out.push('');
    out.push(`[${LEVEL_NAME[level]}]`);
    // 기본값 없는 변수는 한 줄로 모은다
    const nd = list.filter(i => i.group === 'nodefault');
    list = list.filter(i => i.group !== 'nodefault');
    for (const i of list) out.push(`  ${i.file}:${i.line}  ${i.scene ? i.scene.padEnd(6) + ' ' : ''}${i.msg}`);
    if (nd.length) out.push(`  기본값 선언이 없는 변수 ${nd.length}개: ${nd.map(i => `\`${i.var}\`(${i.scene})`).join(', ')}`);
  }
  console.log(out.join('\n'));
  return counts;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const opts = { json: args.includes('--json'), quiet: args.includes('--quiet') };
  const files = args.filter(a => !a.startsWith('--'));
  const result = analyze(loadProject(files));
  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.issues.some(i => i.level === 'error') ? 1 : 0);
  }
  const counts = printReport(result, opts);
  process.exit(counts.error ? 1 : 0);
}

module.exports = { analyze };
