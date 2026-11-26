# 엘도르 연대기 (game_eldor)

엘도르 연대기 저장소입니다. 기획·스크립트 문서와, 더빙 작업실(Project_H)에서 쓰는 작품 파일이 함께 들어 있습니다. 시작할 때는 `docs/eldor_handoff.md`(인수인계)와 `docs/eldor_master_plan.md`(종합 기획서)부터 보세요.

## 위치

- 로컬: `C:\Games\Onee-chan no Yuuwaku\Project_H\works\eldor` — **이 폴더 자체가 game_eldor 저장소**입니다(새 가족의 `works/newfamily` = game_newfamily와 같은 방식). Project_H는 이 폴더를 `.gitignore`로 무시합니다.
- 다른 PC: Project_H를 클론한 뒤 `git clone https://github.com/enorangekid/game_eldor.git works/eldor`
- 커밋·푸시는 **이 폴더 안에서** 합니다.
- 2026-11-26 정리: 예전에는 `Project_H/docs/eldor`(문서만)와 `Project_H/works/eldor`(작업실 파일)로 나뉘어 있었고, 하나로 합쳤습니다. 문서는 저장소 맨 위에서 `docs/`로 옮겼습니다.

## 구성

| 경로 | 내용 |
|---|---|
| `docs/` | 기획서·세계관·인물·스크립트 원본(md). **대사를 고치는 곳은 여기** |
| `tools/eldor/` | 스크립트 분기 검사기·분기도 (`node tools/eldor/check.js`, `node tools/eldor/map.js --open`) — 설명은 `tools/eldor/README.md` |
| `work.json` | 작업실 작품 설정 (제작 모드, 이미지 폴더 `C:\Games\EldorChronicles\novelai`) |
| `intro.js` · `cg_profiles.json` | 게임 소개 페이지 글 · 인물 프로필 |
| `data/` | 작업실·원고 읽기용 씬 데이터 — **md에서 만든 것. 직접 고치지 않는다** |

## 원고 읽기 갱신

`docs/`의 스크립트를 고친 뒤, Project_H 폴더에서:

```
node tools/md_script.js --work eldor 프롤로그=works/eldor/docs/eldor_prologue_script.md 1막=works/eldor/docs/eldor_act1_script.md
```

`data/`가 다시 만들어지고, 원고 읽기(`reader.html?work=eldor`)에 반영됩니다. 🚩 검수 표시는 같은 장·같은 문장이면 남습니다.

## 원본은 md, JS(`data/`)가 아닌 이유 (2026-11-26 정함)

새 가족은 `data/`(JS)가 원본이지만, 엘도르는 **`docs/`의 md가 원본**입니다. 헷갈리지 않게 적어 둡니다.

- **분기가 핵심이라서**: 선택지(`? 선택`)·변수(`→`)·조건(`[if]`)·이동(`⇒`)이 md에는 구조로 남지만, 작업실 JS는 대사를 한 줄씩 늘어놓는 형식이라 분기가 메모(`[선택 1)]`)로만 남습니다.
- **도구가 md를 읽어서**: 분기 검사기·분기도(`tools/eldor`), 나중에 만들 Ren'Py 변환기 모두 md를 읽습니다.
- **아직 초안이라서**: 장면을 옮기고 분기를 다시 짜는 일은 md가 빠릅니다.
- 새 가족이 JS인 건 분기 없는 직선 대본이고, 줄마다 녹음용 대본·프롬프트·🚩를 붙여 관리하기 때문입니다.

**녹음을 시작할 때 다시 정할 것** — 지금은 바꾸지 않습니다. 추천은 md를 원본으로 그대로 두고, `md_script.js`가 🚩처럼 **녹음용 대본(`recordingScript`)·프롬프트도 같은 문장에 옮겨 붙이도록** 고치는 쪽입니다(대사·분기 = md, 녹음 정보 = JS). 다른 길은 그때 원본을 JS로 넘기는 것인데, 그러면 분기 검사를 더 쓸 수 없습니다.
