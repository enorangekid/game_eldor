// 엘도르 연대기 스크립트(마크다운) 파서.
// *_script.md 의 표기 규칙(장면 ID, ? 선택, → 변수, [if]…[end], ⇒ 이동, @조사)을 읽어
// 장면·선택지·변수 변경·조건·이동을 구조로 돌려준다. 검사기(check.js)와 분기도(map.js)가 함께 쓴다.
//
// 표기 규칙 원본: eldor_prologue_script.md 의 '표기 규칙' 표

'use strict';

const fs = require('fs');
const path = require('path');

const SCENE_ID = /[A-Z][A-Z0-9]*-\d+[A-Z]?/;
const RE_SCENE = /^(#{3,4})\s+([A-Z][A-Z0-9]*-\d+[A-Z]?)\s*(.*)$/;
const RE_HEADING = /^(#{1,4})\s+(.*)$/;
const RE_IF = /\[if\s+`([A-Za-z_][\w]*)`\s*(=|≠|!=|≥|>=|≤|<=|>|<)\s*([^\]]+?)\s*\]/;
const RE_ELSE = /^\[else\]/;
const RE_END = /^\[end\]/;
const RE_CHOICE = /^\?\s*(선택|추리)\s*(.*)$/;
const RE_OPTION = /^(\d+)\)\s*(★)?\s*(.*)$/;
const RE_INVEST = /^@조사\s*(.*)$/;
const RE_ITEM = /^-\s+\*\*(.+?)\*\*/;
const RE_EFFECT = /`([A-Za-z_][\w]*)`\s*(=|\+|−|-)\s*([A-Za-z0-9_]+)/g;
const RE_DEFAULT = /`([A-Za-z_][\w]*)`\s+([^\s·`]+)/g;

const OPS = { '!=': '≠', '>=': '≥', '<=': '≤' };

function indentOf(line) {
  const m = line.match(/^[ \t]*/)[0];
  return m.replace(/\t/g, '    ').length;
}

function parseValue(raw) {
  const v = String(raw).trim().replace(/^−/, '-');
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+$/.test(v)) return Number(v);
  return v;
}

function parseMeta(text) {
  const meta = {};
  for (const part of text.split(/\s+·\s+/)) {
    const m = part.match(/^\s*([^:：]+?)\s*[:：]\s*(.*)$/);
    if (m) meta[m[1].trim()] = m[2].trim();
  }
  return meta;
}

// 한 파일을 읽는다. 반환: { file, scenes, defaults, carried, problems }
function parseScript(text, file) {
  const lines = text.split(/\r?\n/);
  const scenes = [];
  const defaults = {};   // 변수 → 기본값 (이 파일에서 선언)
  const carried = [];    // '넘어오는 변수' 목록
  const problems = [];   // 파싱 중 발견한 구조 문제 (if/end 짝 등)

  let chapter = '';
  let scene = null;
  let condStack = [];    // [{var, op, value, line, branch:'if'|'else'}]
  let choice = null;     // 열린 선택지 {indent, ...}
  let option = null;
  let invest = null;     // 열린 @조사 {indent, ...}
  let item = null;

  function closeScene(lineNo) {
    if (!scene) return;
    if (condStack.length) {
      for (const c of condStack) {
        problems.push({ level: 'error', file, line: c.line, scene: scene.id,
          msg: `[if \`${c.var}\` …]에 짝이 되는 [end]가 없습니다` });
      }
    }
    scene.endLine = lineNo - 1;
    scene = null; condStack = []; choice = null; option = null; invest = null; item = null;
  }

  function ctx() {
    return {
      cond: condStack.map(c => ({ var: c.var, op: c.op, value: c.value, branch: c.branch })),
      choice: choice ? choice.index : null,
      option: option ? option.n : null,
      item: item ? item.name : null,
    };
  }

  lines.forEach((raw, i) => {
    const lineNo = i + 1;
    const line = raw.replace(/\s+$/, '');
    const trimmed = line.trim();

    // 파일 머리말의 변수 선언
    if (!scene) {
      if (/^\*\*(?:[^*]*\s)?변수 기본값:\*\*/.test(trimmed)) {
        for (const m of trimmed.matchAll(RE_DEFAULT)) defaults[m[1]] = { value: parseValue(m[2]), line: lineNo };
      } else if (/^\*\*[^*]*넘어오는 변수:\*\*/.test(trimmed)) {
        for (const m of trimmed.matchAll(/`([A-Za-z_][\w]*)`/g)) carried.push({ var: m[1], line: lineNo });
      }
    }

    // 제목
    const sm = line.match(RE_SCENE);
    if (sm) {
      closeScene(lineNo);
      scene = {
        id: sm[2], title: sm[3].trim(), level: sm[1].length, file, line: lineNo, endLine: null,
        chapter, meta: {}, notes: [],
        jumps: [], choices: [], sets: [], reads: [], invests: [], lines: 0,
      };
      scenes.push(scene);
      return;
    }
    const hm = line.match(RE_HEADING);
    if (hm) {
      if (hm[1].length <= 2) {          // '# 장' / '## 부록' → 장면 밖
        closeScene(lineNo);
        if (hm[1].length === 1) chapter = hm[2].trim();
      }
      // '#### 언덕 위' 처럼 ID 없는 소제목은 장면 안의 구획으로 둔다
      return;
    }
    if (!scene) return;
    if (trimmed === '---') { closeScene(lineNo); return; }
    if (!trimmed) return;

    const ind = indentOf(line);

    // 장면 정보
    if (trimmed.startsWith('>')) {
      const body = trimmed.replace(/^>\s*/, '');
      if (/^\(/.test(body)) scene.notes.push(body.replace(/^\(|\)$/g, ''));
      else Object.assign(scene.meta, parseMeta(body));
      return;
    }

    // 열린 선택지·조사 닫기 (들여쓰기가 돌아오면)
    if (choice && ind <= choice.indent && !RE_OPTION.test(trimmed)) { choice = null; option = null; }
    if (invest && ind <= invest.indent && !RE_ITEM.test(trimmed)) { invest = null; item = null; }

    // 조건
    const im = trimmed.match(RE_IF);
    if (im && trimmed.startsWith('[if')) {
      const c = { var: im[1], op: OPS[im[2]] || im[2], value: parseValue(im[3].replace(/`/g, '')), line: lineNo, branch: 'if' };
      scene.reads.push({ var: c.var, op: c.op, value: c.value, line: lineNo, ...ctx() });
      condStack.push(c);
      return;
    }
    if (RE_ELSE.test(trimmed)) {
      if (!condStack.length) problems.push({ level: 'error', file, line: lineNo, scene: scene.id, msg: '[else] 앞에 [if]가 없습니다' });
      else condStack[condStack.length - 1].branch = 'else';
      return;
    }
    if (RE_END.test(trimmed)) {
      if (!condStack.length) problems.push({ level: 'error', file, line: lineNo, scene: scene.id, msg: '[end] 앞에 [if]가 없습니다' });
      else condStack.pop();
      return;
    }

    // 선택지
    const cm = trimmed.match(RE_CHOICE);
    if (cm) {
      const title = cm[2].replace(/^[\s—-]+/, '').trim();
      choice = { index: scene.choices.length, kind: cm[1], title, line: lineNo, indent: ind, options: [], cond: ctx().cond };
      option = null;
      scene.choices.push(choice);
      return;
    }
    const om = trimmed.match(RE_OPTION);
    if (om && choice && ind > choice.indent) {
      option = { n: Number(om[1]), star: !!om[2], text: om[3].trim(), line: lineNo, indent: ind, sets: [], jump: null };
      choice.options.push(option);
      // 같은 줄에 붙은 효과·이동은 없지만 혹시 있으면 아래에서 함께 처리
    } else if (option && ind <= option.indent) {
      option = null;
    }

    // 조사
    const vm = trimmed.match(RE_INVEST);
    if (vm) {
      invest = { title: vm[1].trim(), line: lineNo, indent: ind, items: [] };
      item = null;
      scene.invests.push(invest);
      return;
    }
    const itm = trimmed.match(RE_ITEM);
    if (itm && invest && ind >= invest.indent) {
      item = { name: itm[1].trim(), line: lineNo };
      invest.items.push(item);
    }

    // 변수 변경
    if (trimmed.startsWith('→')) {
      const body = trimmed.slice(1);
      for (const m of body.matchAll(RE_EFFECT)) {
        const op = m[2] === '=' ? '=' : (m[2] === '+' ? '+' : '-');
        const s = { var: m[1], op, value: parseValue(m[3]), line: lineNo, ...ctx(),
          conditional: /맞히면|하면|면\s*`/.test(body.split('`')[0]) };
        scene.sets.push(s);
        if (option) option.sets.push(s);
      }
    }

    // 이동
    const jm = trimmed.match(/⇒\s*(.+)$/);
    if (jm) {
      const targetText = jm[1].trim();
      const idm = targetText.match(SCENE_ID);
      const j = { to: idm ? idm[0] : null, text: targetText, line: lineNo, ...ctx() };
      scene.jumps.push(j);
      if (option && !option.jump) option.jump = j;
    }

    scene.lines++;
  });
  closeScene(lines.length + 1);

  // 선택지 정리: indent 등 내부 값 제거
  for (const s of scenes) {
    for (const c of s.choices) {
      delete c.indent;
      for (const o of c.options) delete o.indent;
    }
    for (const v of s.invests) delete v.indent;
  }

  return { file, scenes, defaults, carried, problems };
}

// 기본 대상: 막 순서대로. 새 막 스크립트가 생기면 여기에 추가한다.
const DEFAULT_FILES = [
  'docs/eldor_prologue_script.md',
  'docs/eldor_act1_script.md',
];

function repoRoot() {
  return path.resolve(__dirname, '..', '..');
}

function loadProject(files) {
  const root = repoRoot();
  const list = (files && files.length ? files : DEFAULT_FILES);
  const parsed = list.map(f => {
    const abs = path.isAbsolute(f) ? f : path.join(root, f);
    const rel = path.relative(root, abs).replace(/\\/g, '/');
    return parseScript(fs.readFileSync(abs, 'utf8'), rel);
  });
  return { root, files: parsed };
}

module.exports = { parseScript, loadProject, DEFAULT_FILES, parseValue };
