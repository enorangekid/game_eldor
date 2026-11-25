#!/usr/bin/env node
// 엘도르 연대기 분기도 만들기.
//
//   node tools/eldor/map.js            tools/eldor/out/eldor_map.html 생성
//   node tools/eldor/map.js --open     만든 뒤 브라우저로 열기
//   node tools/eldor/map.js --watch    스크립트가 바뀔 때마다 다시 만들기 (브라우저는 새로고침)
//   node tools/eldor/map.js 파일.md …  지정한 파일만 (막 순서대로)
//
// 결과 파일은 데이터가 들어 있는 HTML 한 장이라 인터넷 없이 더블클릭으로 열린다.
// 검사 결과(check.js)도 함께 들어가므로, 분기도에서 문제가 있는 장면이 표시된다.

'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { loadProject, DEFAULT_FILES } = require('./parse.js');
const { analyze } = require('./check.js');

const OUT_DIR = path.join(__dirname, 'out');
const OUT = path.join(OUT_DIR, 'eldor_map.html');
const TEMPLATE = path.join(__dirname, 'map_template.html');

function build(files) {
  const result = analyze(loadProject(files));
  result.generatedAt = new Date().toLocaleString('ko-KR', { hour12: false });
  const json = JSON.stringify(result).replace(/</g, '\\u003c');
  const html = fs.readFileSync(TEMPLATE, 'utf8').replace('/*__DATA__*/null', json);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT, html);
  const c = { error: 0, warn: 0, info: 0 };
  for (const i of result.issues) c[i.level]++;
  console.log(`[${result.generatedAt}] 분기도 저장: ${path.relative(process.cwd(), OUT)} — 장면 ${result.scenes.length} · 오류 ${c.error} · 주의 ${c.warn} · 참고 ${c.info}`);
  return result;
}

function openInBrowser(file) {
  if (process.platform === 'win32') execFile('cmd', ['/c', 'start', '', file]);
  else execFile(process.platform === 'darwin' ? 'open' : 'xdg-open', [file]);
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const files = args.filter(a => !a.startsWith('--'));
  build(files);
  if (args.includes('--open')) openInBrowser(OUT);
  if (args.includes('--watch')) {
    const root = path.resolve(__dirname, '..', '..');
    const watchList = (files.length ? files : DEFAULT_FILES).map(f => (path.isAbsolute(f) ? f : path.join(root, f)));
    watchList.push(TEMPLATE);
    let timer = null;
    for (const f of watchList) {
      fs.watch(f, () => {
        clearTimeout(timer);
        timer = setTimeout(() => { try { build(files); } catch (e) { console.error('다시 만들기 실패:', e.message); } }, 200);
      });
    }
    console.log('스크립트 변경을 지켜보는 중 — 멈추려면 Ctrl+C');
  }
}

module.exports = { build, OUT };
