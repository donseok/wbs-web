# dev-workflow Toolchain (DEV-02·DEV-03) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

## Goal

**결정 A(WBS 중앙관리 — DB 정본)** 아래에서 dev 플러그인이 해야 할 일은 하나로 좁혀졌다:
**로컬 `wbs.md` 를 D'Flow 로 한 번 밀어 넣는 부트스트랩 경로를 정확하게 만드는 것.**

import 이후 정본은 D'Flow DB 다. `/dev` 계열은 API + 로컬 캐시(claim 시 `dflow.sh` 가 명세를
`docs/tasks/{TSK}/spec.md` 로 캐시)로 소비하고, `wbs.md` 는 **최초 작성·import 부트스트랩 전용**으로 은퇴한다.
`state.json` 5상태 사이클 내부는 그대로 둔다.

| ID | 내용 | 이 계획에서의 위치 |
|---|---|---|
| **DEV-02** | `wbs-parse.py --export` — 전 계층·전 필드 JSON (**계약 v2**) | **중심.** Task 2·3 |
| **DEV-03** | 4단계(ACT) WBS 파싱 — `### TSK-\d+-\d+` 2세그먼트 고정 정정 | **유지.** 부트스트랩 import·검증에 필수. Task 4·5 |
| (부수) | dep-analysis 의존 충족 임계 문서(`[im]`)↔코드(`[xx]`) 불일치 | **유지·비중 낮춤.** 부트스트랩 전 로컬 검증용. Task 6 |
| ~~DEV-01~~ | ~~로컬 6상태 상태머신 실행~~ | **스코프 아웃.** 근거·설계는 부록 A |
| ~~DEV-04~~ | 프로그램 리스트 입력 어댑터(`wbs-wsf` 스킬) | 처음부터 범위 밖. 별도 계획 |

**DEV-01 이 왜 빠졌는가** — 로컬 `wbs.md` 에서 6상태(`[as]/[fp]/[ip]` + `assign/accept/force`)를 실행할
이유가 결정 A 로 대부분 소멸했다. 상태 전이의 정본은 D'Flow `stage`(API)이고, 로컬은 사이클 내부
(`design.ok`/`build.ok`/`test.ok`/`refactor.ok`) 만 돌린다. 상세는 **부록 A**.

## Architecture

```
docs/<모듈>/wbs.md   ← 최초 작성·검수 (은퇴 예정 표면)
      │
      ├─ wbs-validate.py validate      ← Task 4: 4단계 인식 (지금은 40건을 0건으로 읽는다)
      ├─ dep-analysis.py --docs-dir    ← Task 6: 의존 충족 임계
      └─ wbs-parse.py --export         ← Task 2·3: 계약 v2 JSON  ★계획의 중심
                  │
                  └→ 변환기 → POST /api/v1/wbs/import → wbs_items   (여기부터 DB 정본)
                                                             │
                                    /dev ← dflow.sh (API + docs/tasks/{TSK}/spec.md 캐시)
```

`scripts/_wbs_status.py`(신설)가 두 소비자의 공통 기반이다 — **상태 어휘 매핑표**(파일 `[xx]` ↔
D'Flow `stage` 코드, 부록 계약 §7.2-2)와 **상태머신 해석**(dep 임계용).

`merge-wbs-status.py`(Task 5)는 은퇴 전 **작성·검수 구간**을 지킨다 — 4단계 `wbs.md` 를 여러 명이
동시에 손보는 것은 부트스트랩 직전까지 실제로 일어나며, 지금은 드라이버가 조용히 무력화된다.

## Tech Stack

- Python 3, **stdlib only** (기존 전 스크립트 관례).
- 테스트: `unittest` 클래스 + `python3 -m pytest` 실행. 하이픈 있는 스크립트는
  `importlib.util.spec_from_file_location` 로 로드, CLI 검증은 `subprocess.run([sys.executable, ...])`.
  신설 `scripts/_wbs_status.py` 는 하이픈이 없으므로 `sys.path.insert(0, ...)` 후 `import _wbs_status`
  — importlib 보일러플레이트 불필요(`wp-setup.py:21-22` 관례).

## Global Constraints

- **대상 리포는 `/Users/jji/project/dev-plugin` 이다.** wbs-web 이 아니다.
  `~/.claude/plugins/marketplaces/dev-tools/` 는 같은 리포의 설치본이며 현재 같은 커밋(`44995bf`)이다 — **거기서 편집하지 않는다.**
- **기존 5상태 사용자 회귀 금지.** 이 계획은 상태 어휘를 **읽기만** 하고 로컬 상태머신을 바꾸지 않는다
  (`references/state-machine.json` 무변경 · `wbs-transition.py` 무변경 · `merge-state-json.py` 무변경).
  트립와이어 두 개를 매 task 종료 시 확인한다:
  - `scripts/test_merge_state_json.py::MergeStateJsonTests::test_merge_state_json_status_priority_matrix`
  - `scripts/test_merge_wbs_status.py::MergeWbsStatusTests::test_merge_wbs_status_priority`
- 테스트 명령 (리포 루트에서):
  ```bash
  cd /Users/jji/project/dev-plugin
  python3 -m pytest scripts/test_wbs_status.py -q                 # task 별 신규 테스트
  python3 -m pytest scripts/test_merge_wbs_status.py scripts/test_merge_state_json.py \
    scripts/test_wbs_validate.py scripts/test_wbs_transition_verification.py \
    scripts/test_dep_analysis_critical_path.py scripts/test_dep_analysis_graph_stats.py -q   # 회귀 세트
  ```
- 커밋: **`git add -A` 금지 — 파일명을 명시해 stage 한다.** 커밋 메시지는 한국어, "무엇"보다 "왜".
- 테스트 픽스처는 **인라인 임시 디렉터리로 만든다.** `/Users/jji/project/dev-workflow/docs/MES/wbs.md` 등
  리포 밖 절대경로에 의존하지 않는다(수동 확인 명령으로만 쓴다).
- 스킬(`skills/*/SKILL.md`)은 이 계획에서 수정하지 않는다.

---

### Task 1: 상태 어휘 공유 모듈 `_wbs_status.py`

**Files**
- Create: `scripts/_wbs_status.py`
- Create: `scripts/test_wbs_status.py`

**Interfaces**

Produces (Task 2·3 은 `stage_code`, Task 6 은 `resolve_state_machine`·`satisfied_states` 를 쓴다):

```python
V5_STATES: tuple            # ("[ ]", "[dd]", "[im]", "[ts]", "[xx]")  로컬 사이클 어휘
V6_STATES: tuple            # ("[ ]", "[as]", "[fp]", "[ip]", "[im]", "[xx]")  D'Flow stage 축
V6_ONLY: tuple              # ("[as]", "[fp]", "[ip]")  — 어휘 판별 지표
STAGE_CODE: dict            # 파일 표기 → D'Flow stage 코드 (계약 §7.2-2)

is_v6_states(states) -> bool
is_v6_sm(sm) -> bool
stage_code(status: str) -> str | None          # "[ ]" -> "todo", "[dd]" -> "ip"
known_states(sm: dict) -> set
satisfied_states(sm: dict) -> set              # v6 -> {"[im]","[xx]"}, else {"[xx]"}
resolve_state_machine(docs_dir: str | None = None) -> tuple[dict|None, str|None, str|None]
                                               # (sm, path, err)
```

**상태 어휘 매핑표** — 로컬은 5상태로 계속 돌고, export 만 D'Flow stage 코드로 번역한다:

| 파일(wbs.md / state.json) | D'Flow `stage` | 근거 |
|---|---|---|
| `[ ]` | `todo` | 미착수 |
| `[dd]` 설계 완료 | `ip` | 사이클 내부 — D'Flow 에는 대응 단계가 없다 |
| `[im]` 구현 완료 | `im` | 코드 유지 |
| `[ts]` 테스트 통과 | `ip` | 사이클 내부 |
| `[xx]` | `xx` | 완료 |
| `[dd!]` / `[im!]` (레거시 마커) | `todo` / `ip` | `wbs-transition.py:346-349` 의 기존 정규화와 정합 |
| `[as]` / `[fp]` / `[ip]` | `as` / `fp` / `ip` | D'Flow 가 되쓴 값을 다시 읽을 때만 등장 |

**상태머신 해석 체인** (Task 6 전용 — `dep-analysis` 가 프로젝트 임계를 알아야 한다):

```
env WBS_STATE_MACHINE
  → {docs_dir}/state-machine.json
  → {docs_dir}/../state-machine.json      ← docs/<모듈>/wbs.md 레이아웃 대응
  → {PLUGIN_ROOT}/references/state-machine.json   ← 5상태 기본값 (무변경)
```

**Steps**

- [ ] `scripts/test_wbs_status.py` 를 작성한다 (실패하는 테스트 먼저):

```python
#!/usr/bin/env python3
"""_wbs_status.py — 상태 어휘 공유 모듈 단위 테스트."""
from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

_THIS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(_THIS_DIR))
import _wbs_status  # noqa: E402

V5_SM = {"states": {"[ ]": {}, "[dd]": {}, "[im]": {}, "[ts]": {}, "[xx]": {}},
         "events": {"design.ok": "…", "build.ok": "…"}}
V6_SM = {
    "states": {"[ ]": {}, "[as]": {}, "[fp]": {}, "[ip]": {}, "[im]": {}, "[xx]": {}},
    "events": {"assign": "…", "cycle.start": "…", "refactor.ok": "…", "accept": "…"},
}


class VocabularyDetection(unittest.TestCase):
    def test_is_v6_sm(self):
        self.assertTrue(_wbs_status.is_v6_sm(V6_SM))
        self.assertFalse(_wbs_status.is_v6_sm(V5_SM))
        self.assertFalse(_wbs_status.is_v6_sm(None))

    def test_is_v6_states(self):
        self.assertTrue(_wbs_status.is_v6_states({"[ ]", "[ip]"}))
        self.assertFalse(_wbs_status.is_v6_states({"[ ]", "[dd]", "[xx]"}))
        self.assertFalse(_wbs_status.is_v6_states(set()))

    def test_known_states(self):
        self.assertEqual(_wbs_status.known_states(V5_SM),
                         {"[ ]", "[dd]", "[im]", "[ts]", "[xx]"})
        self.assertEqual(_wbs_status.known_states(None), set())


class StageMapping(unittest.TestCase):
    def test_local_five_state_maps_to_dflow_stage(self):
        self.assertEqual(_wbs_status.stage_code("[ ]"), "todo")
        self.assertEqual(_wbs_status.stage_code("[dd]"), "ip")
        self.assertEqual(_wbs_status.stage_code("[im]"), "im")
        self.assertEqual(_wbs_status.stage_code("[ts]"), "ip")
        self.assertEqual(_wbs_status.stage_code("[xx]"), "xx")

    def test_legacy_markers(self):
        self.assertEqual(_wbs_status.stage_code("[dd!]"), "todo")
        self.assertEqual(_wbs_status.stage_code("[im!]"), "ip")

    def test_six_state_codes_round_trip(self):
        self.assertEqual(_wbs_status.stage_code("[as]"), "as")
        self.assertEqual(_wbs_status.stage_code("[fp]"), "fp")
        self.assertEqual(_wbs_status.stage_code("[ip]"), "ip")

    def test_whitespace_and_unknown(self):
        self.assertEqual(_wbs_status.stage_code("  [xx]  "), "xx")
        self.assertIsNone(_wbs_status.stage_code("[zz]"))
        self.assertIsNone(_wbs_status.stage_code(""))
        self.assertIsNone(_wbs_status.stage_code(None))


class Dependencies(unittest.TestCase):
    def test_satisfied_states(self):
        self.assertEqual(_wbs_status.satisfied_states(V6_SM), {"[im]", "[xx]"})
        self.assertEqual(_wbs_status.satisfied_states(V5_SM), {"[xx]"})
        self.assertEqual(_wbs_status.satisfied_states(None), {"[xx]"})

    def test_explicit_override_wins(self):
        sm = {"states": {"[ ]": {}}, "dependency": {"satisfied_states": ["[ts]", "[xx]"]}}
        self.assertEqual(_wbs_status.satisfied_states(sm), {"[ts]", "[xx]"})


class Resolution(unittest.TestCase):
    def test_docs_dir_override_beats_plugin_default(self):
        with tempfile.TemporaryDirectory() as tmp:
            docs = Path(tmp) / "docs"
            (docs / "MES").mkdir(parents=True)
            (docs / "state-machine.json").write_text(
                json.dumps(V6_SM), encoding="utf-8")
            sm, path, err = _wbs_status.resolve_state_machine(str(docs / "MES"))
            self.assertIsNone(err)
            self.assertEqual(path, str(docs / "state-machine.json"))
            self.assertTrue(_wbs_status.is_v6_sm(sm))

    def test_same_dir_override(self):
        with tempfile.TemporaryDirectory() as tmp:
            docs = Path(tmp) / "docs"
            docs.mkdir(parents=True)
            (docs / "state-machine.json").write_text(
                json.dumps(V6_SM), encoding="utf-8")
            sm, path, err = _wbs_status.resolve_state_machine(str(docs))
            self.assertIsNone(err)
            self.assertEqual(path, str(docs / "state-machine.json"))

    def test_falls_back_to_plugin_5state(self):
        with tempfile.TemporaryDirectory() as tmp:
            sub = Path(tmp) / "a" / "b"
            sub.mkdir(parents=True)
            sm, path, err = _wbs_status.resolve_state_machine(str(sub))
            self.assertIsNone(err, err)
            self.assertTrue(path.endswith(os.path.join(
                "references", "state-machine.json")))
            self.assertFalse(_wbs_status.is_v6_sm(sm))

    def test_env_override_wins(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "custom.json"
            p.write_text(json.dumps(V6_SM), encoding="utf-8")
            os.environ["WBS_STATE_MACHINE"] = str(p)
            try:
                sm, path, err = _wbs_status.resolve_state_machine(None)
                self.assertIsNone(err)
                self.assertEqual(path, str(p))
            finally:
                del os.environ["WBS_STATE_MACHINE"]


if __name__ == "__main__":
    unittest.main()
```

- [ ] 실패를 확인한다: `cd /Users/jji/project/dev-plugin && python3 -m pytest scripts/test_wbs_status.py -q`
      → 기대 출력: `ModuleNotFoundError: No module named '_wbs_status'` (collection error, 0 passed)
- [ ] `scripts/_wbs_status.py` 를 작성한다:

```python
"""_wbs_status.py — WBS 상태 어휘 공유 정의.

로컬 사이클은 5상태(`references/state-machine.json`)로 계속 돈다. 이 모듈은
① 로컬 표기를 D'Flow `stage` 코드로 번역하는 매핑표(export 계약 §7.2-2)와
② 프로젝트 상태머신 해석(dep 충족 임계)을 제공한다. 로컬 상태머신 자체는 바꾸지 않는다.
"""
from __future__ import annotations

import json
import os

# --- 어휘 ---------------------------------------------------------------

# 로컬 사이클 어휘 (플러그인 references/state-machine.json)
V5_STATES = ("[ ]", "[dd]", "[im]", "[ts]", "[xx]")

# D'Flow stage 축 (dev-workflow docs/state-machine.json — 서버가 소유)
V6_STATES = ("[ ]", "[as]", "[fp]", "[ip]", "[im]", "[xx]")

# 6상태에만 존재하는 코드. 어휘 판별의 유일한 지표.
V6_ONLY = ("[as]", "[fp]", "[ip]")

# 파일 표기 → D'Flow stage 코드.
# [dd]/[ts] 는 사이클 내부 단계라 D'Flow 에 대응 상태가 없다 — 둘 다 진행 중(ip).
STAGE_CODE = {
    "[ ]": "todo", "[as]": "as", "[fp]": "fp",
    "[ip]": "ip", "[im]": "im", "[xx]": "xx",
    "[dd]": "ip", "[ts]": "ip", "[dd!]": "todo", "[im!]": "ip",
}


# --- 판별 ---------------------------------------------------------------

def is_v6_states(states) -> bool:
    """상태 코드 집합이 6상태 어휘인지."""
    if not states:
        return False
    return any(code in states for code in V6_ONLY)


def is_v6_sm(sm) -> bool:
    return is_v6_states(set((sm or {}).get("states", {}).keys()))


def known_states(sm) -> set:
    return set((sm or {}).get("states", {}).keys())


def stage_code(status):
    """파일 표기 → D'Flow stage 코드. 모르는 표기는 None (지어내지 않는다)."""
    return STAGE_CODE.get((status or "").strip())


# --- 의존 충족 -----------------------------------------------------------

def satisfied_states(sm) -> set:
    """의존 충족으로 인정하는 상태 집합.

    6상태 정의에서는 사람 검수([xx]) 대기가 병렬 진행을 막지 않도록 [im] 부터 충족.
    5상태 정의(플러그인 기본)에서는 현행대로 [xx] 만.
    """
    explicit = ((sm or {}).get("dependency") or {}).get("satisfied_states")
    if isinstance(explicit, list) and explicit:
        return set(explicit)
    return {"[im]", "[xx]"} if is_v6_sm(sm) else {"[xx]"}


# --- 상태머신 해석 -------------------------------------------------------

def state_machine_candidates(docs_dir=None) -> list:
    """해석 후보 경로를 우선순위 순으로 반환."""
    out = []
    env = os.environ.get("WBS_STATE_MACHINE")
    if env:
        out.append(env)
    if docs_dir is not None:
        base = os.path.abspath(docs_dir or ".")
        out.append(os.path.join(base, "state-machine.json"))
        # docs/<모듈>/wbs.md 레이아웃 — 한 단계 위까지만 본다
        out.append(os.path.join(os.path.dirname(base), "state-machine.json"))
    plugin_root = os.environ.get("CLAUDE_PLUGIN_ROOT") or \
        os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out.append(os.path.join(plugin_root, "references", "state-machine.json"))
    return out


def resolve_state_machine(docs_dir=None):
    """(sm, path, err) 반환. 첫 번째로 존재하는 후보를 쓴다."""
    tried = []
    for path in state_machine_candidates(docs_dir):
        tried.append(path)
        if not os.path.isfile(path):
            continue
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f), path, None
        except (OSError, json.JSONDecodeError) as e:
            return None, path, f"failed to load {path}: {e}"
    return None, None, "state-machine.json not found (tried: " + ", ".join(tried) + ")"
```

- [ ] 통과를 확인한다: `python3 -m pytest scripts/test_wbs_status.py -q` → 기대 출력: `13 passed`
- [ ] 회귀 세트를 돌린다 (기존 파일을 건드리지 않았으므로 전부 초록이어야 한다).
- [ ] 커밋: `git add scripts/_wbs_status.py scripts/test_wbs_status.py && git commit -m "feat(wbs): 상태 어휘 매핑표 — 로컬 사이클 표기를 D'Flow stage 코드로 번역하는 단일 지점"`

---

### Task 2: wbs-parse — 전 계층 노드 파서 `parse_nodes` (DEV-02, 계약 v2)

**Files**
- Modify: `scripts/wbs-parse.py` (import 블록 7-10, `parse_tasks_from_wp` 192-230 아래에 신규 함수 추가)
- Create: `scripts/test_wbs_parse_export.py`

**Interfaces**

Produces:
```python
parse_nodes(wbs_text: str, docs_dir: str) -> list[dict]
```
노드는 **Phase → WP → ACT → Task** 순으로 나온다(부모가 자식보다 앞선다).
모든 노드가 **같은 키 집합 17개**를 가진다(없는 값은 `null`/`[]`) — 임포터가 `kind` 로 분기하지 않도록.

**계약 v2 노드 스키마 (사용자 확정 — 이대로 고정):**

```json
{
  "id": "TSK-00-01-01",
  "parent_id": "ACT-00-01",
  "kind": "task",
  "title": "스캐폴드 + DB 연결 + CI",
  "stage": "todo",
  "category": "infra",
  "domain": "infra",
  "model": "sonnet",
  "assignee": null,
  "schedule": "2026-08-05 ~ 2026-08-06",
  "priority": "critical",
  "tags": ["setup", "init"],
  "depends": [],
  "prd_ref": "공통 (BPA 외)",
  "entry_point": null,
  "acceptance": ["`npm run dev` 기동", "DB 연결 헬스체크 통과"],
  "spec_sections": {
    "requirements": ["Next.js 15 + TypeScript 프로젝트 생성"],
    "test_criteria": [],
    "constraints": [],
    "api_spec": null,
    "data_model": null,
    "description": null
  }
}
```

규칙:
- `kind`: `phase` / `wp` / `act` / `task`
- 계층: Phase ← WP(`- phase:` 값) ← ACT ← Task. ACT 가 없으면 Task 의 부모는 WP.
- Phase 노드는 WP 의 `- phase:` 값에서 **최초 등장 순서로 합성**한다. `title = id`
  (wbs.md 에 Phase 이름 표기가 없다 — 이름을 지어내지 않는다).
- `-` 센티널과 빈 값은 `null` 로 접는다(`assignee: -` → `null`).
- `stage`: `- status:` 값을 state.json 으로 덮어쓴 뒤 `_wbs_status.stage_code` 로 변환. Task 외 노드는 `null`.
  **대괄호 표기는 계약에 나가지 않는다** — wbs.md 표면 한정.
- `priority` 는 **문자열 라벨 그대로**(`critical`/`high`/`medium`/`low`). 정수 매핑은 D'Flow import 책임.
- `tags` 는 `- tags: setup, init` 쉼표 구분 스칼라를 배열로 편다.
- `acceptance` 는 최상위(불릿 배열). `spec_sections` 안에 넣지 않는다.
- `spec_sections.api_spec` / `.data_model` 은 **문자열|null** — 불릿 리스트를 개행으로 잇고 비면 `null`.
- `spec_sections.description` 은 `- description:` 스칼라 — 실측상 WP 노드에만 존재한다(MES 6/6, bookloop 7/7).
- WP 노드는 `schedule` 과 `spec_sections.description` 을 채운다. ACT 노드는 제목만 있다(MES ACT 블록에 메타데이터가 없다).

**실측 필드 인벤토리** (파서·테스트의 근거):

| 필드 | MES(40 Task) | bookloop(13 Task) | v2 매핑 |
|---|---|---|---|
| category·domain·model·status·priority·assignee·schedule·tags·depends·entry-point | 40 | 13 | 최상위 |
| prd-ref | 40 | 8 | `prd_ref` |
| acceptance | 40 | 13 | 최상위 `acceptance[]` |
| requirements | 40 | 13 | `spec_sections.requirements[]` |
| test-criteria | 18 | 6 | `spec_sections.test_criteria[]` |
| constraints | 2 | 6 | `spec_sections.constraints[]` |
| api-spec | 2 | 6 | `spec_sections.api_spec` (문자열) |
| data-model | 1 | 3 | `spec_sections.data_model` (문자열) |
| description | WP 6 | WP 7 | `spec_sections.description` |

**의도적으로 계약 밖**: `tech-spec`(bookloop 5) · `ui-spec`(bookloop 6) · `note`(2) · `blocked-by`(1).
v2 필드 목록이 확정본이므로 추가하지 않는다. 필요해지면 계약 v3 안건이다.

Consumes: 기존 `extract_task_block`(57-87) · `get_field`(109-119) · `parse_list_field`(122-170) ·
`_load_task_state_json`(539-551) · `_wbs_status.stage_code`

**Steps**

- [ ] `scripts/test_wbs_parse_export.py` 를 작성한다:

```python
#!/usr/bin/env python3
"""wbs-parse.py --export — 전 계층 노드 파서 테스트 (DEV-02 계약 v2)."""
from __future__ import annotations

import importlib.util
import json
import pathlib
import subprocess
import sys
import tempfile
import unittest

_THIS_DIR = pathlib.Path(__file__).resolve().parent
_MODULE_PATH = _THIS_DIR / "wbs-parse.py"
_spec = importlib.util.spec_from_file_location("wbs_parse", _MODULE_PATH)
wbs_parse = importlib.util.module_from_spec(_spec)
sys.modules["wbs_parse"] = wbs_parse
_spec.loader.exec_module(wbs_parse)

NODE_KEYS = {
    "id", "parent_id", "kind", "title", "stage", "category", "domain", "model",
    "assignee", "schedule", "priority", "tags", "depends", "prd_ref",
    "entry_point", "acceptance", "spec_sections",
}
SPEC_KEYS = {
    "requirements", "test_criteria", "constraints",
    "api_spec", "data_model", "description",
}

# MES wbs.md 실측 구조 (4단계, ##### 하위 절 2종)
FOURLEVEL = """\
# WBS

## WP-00: 초기화
- phase: PH-1
- schedule: 2026-08-05 ~ 2026-08-18
- description: 스캐폴드·CI, 전사 공유 계약

### ACT-00-01: 공통 기반

전 모듈이 공유하는 기반.

#### TSK-00-01-01: 스캐폴드
- category: infra
- domain: infra
- model: sonnet
- status: [ ]
- priority: critical
- assignee: -
- schedule: 2026-08-05 ~ 2026-08-06
- tags: setup, init
- depends: -
- entry-point: -

##### PRD 요구사항
- prd-ref: 공통 (BPA 외)
- requirements:
  - 프로젝트 생성, env 배선
  - CI 파이프라인
- acceptance:
  - dev 서버 기동
  - 헬스체크 통과

#### TSK-00-01-02: 시드
- category: infra
- domain: database
- model: opus
- status: [im]
- priority: high
- assignee: lee@example.com
- schedule: 2026-08-07 ~ 2026-08-08
- tags: contract, schema
- depends: TSK-00-01-01
- entry-point: layout (전 화면 공통 셸)

##### PRD 요구사항
- prd-ref: BPA 공통
- requirements:
  - 시드 3건
- acceptance:
  - 적재 확인
- constraints:
  - 모듈 전용 엔티티 금지

##### 기술 스펙 (TRD)
- api-spec:
  - `confirmReceiving(lotId)` — 단일 트랜잭션 RPC
- data-model:
  - common_code(그룹, 코드, 명칭)
- test-criteria:
  - 단위: 전이 / E2E: 수신 3유형

## WP-01: 기능
- phase: PH-2
- schedule: 2026-08-19 ~ 2026-09-01

### ACT-01-01: 로그인

#### TSK-01-01-01: 로그인 API
- category: dev
- domain: backend
- model: sonnet
- status: [ts]
- priority: high
- assignee: -
- schedule: 2026-08-19 ~ 2026-08-22
- tags: -
- depends: TSK-00-01-02
- entry-point: /login

##### PRD 요구사항
- requirements:
  - 로그인 처리
- acceptance:
  - 응답 200ms 이하
"""

# bookloop wbs.md 실측 구조 (3단계, #### 하위 절)
THREELEVEL = """\
# WBS

## WP-00: 초기화
- phase: PH-1
- schedule: 2026-08-05 ~ 2026-08-18
- description: 스캐폴드·CI

### TSK-00-01: 스캐폴드
- category: infra
- domain: infra
- model: sonnet
- status: [dd]
- priority: critical
- assignee: -
- schedule: 2026-08-05 ~ 2026-08-06
- tags: setup
- depends: -
- entry-point: -

#### PRD 요구사항
- requirements:
  - Next.js 15 생성
- acceptance: dev 서버 기동
"""


def _docs(tmp: pathlib.Path, text: str) -> pathlib.Path:
    mod = tmp / "docs" / "MOD"
    mod.mkdir(parents=True)
    wbs = mod / "wbs.md"
    wbs.write_text(text, encoding="utf-8")
    return wbs


class ParseNodesHierarchy(unittest.TestCase):
    def test_four_level_hierarchy(self):
        nodes = wbs_parse.parse_nodes(FOURLEVEL, "")
        by_id = {n["id"]: n for n in nodes}
        self.assertEqual(
            [n["id"] for n in nodes if n["kind"] == "phase"], ["PH-1", "PH-2"])
        self.assertIsNone(by_id["PH-1"]["parent_id"])
        self.assertEqual(by_id["PH-1"]["title"], "PH-1")
        self.assertEqual(by_id["WP-00"]["parent_id"], "PH-1")
        self.assertEqual(by_id["WP-00"]["schedule"], "2026-08-05 ~ 2026-08-18")
        self.assertEqual(by_id["WP-00"]["spec_sections"]["description"],
                         "스캐폴드·CI, 전사 공유 계약")
        self.assertEqual(by_id["ACT-00-01"]["parent_id"], "WP-00")
        self.assertEqual(by_id["TSK-00-01-01"]["parent_id"], "ACT-00-01")
        self.assertEqual(by_id["TSK-01-01-01"]["parent_id"], "ACT-01-01")

    def test_node_counts(self):
        nodes = wbs_parse.parse_nodes(FOURLEVEL, "")
        kinds = {}
        for n in nodes:
            kinds[n["kind"]] = kinds.get(n["kind"], 0) + 1
        self.assertEqual(kinds, {"phase": 2, "wp": 2, "act": 2, "task": 3})

    def test_three_level_task_parents_are_wps(self):
        nodes = wbs_parse.parse_nodes(THREELEVEL, "")
        by_id = {n["id"]: n for n in nodes}
        self.assertEqual(by_id["TSK-00-01"]["parent_id"], "WP-00")
        self.assertEqual([n for n in nodes if n["kind"] == "act"], [])
        self.assertEqual(by_id["TSK-00-01"]["acceptance"], ["dev 서버 기동"])


class ParseNodesContractV2(unittest.TestCase):
    def test_uniform_key_set(self):
        for n in wbs_parse.parse_nodes(FOURLEVEL, ""):
            self.assertEqual(set(n.keys()), NODE_KEYS, n["id"])
            self.assertEqual(set(n["spec_sections"].keys()), SPEC_KEYS, n["id"])

    def test_task_top_level_fields(self):
        by_id = {n["id"]: n for n in wbs_parse.parse_nodes(FOURLEVEL, "")}
        t = by_id["TSK-00-01-01"]
        self.assertEqual(t["kind"], "task")
        self.assertEqual(t["title"], "스캐폴드")
        self.assertEqual(t["stage"], "todo")
        self.assertEqual(t["category"], "infra")
        self.assertEqual(t["domain"], "infra")
        self.assertEqual(t["model"], "sonnet")
        self.assertIsNone(t["assignee"])            # '-' 는 null
        self.assertEqual(t["schedule"], "2026-08-05 ~ 2026-08-06")
        self.assertEqual(t["priority"], "critical")  # 문자열 라벨 그대로
        self.assertEqual(t["tags"], ["setup", "init"])
        self.assertEqual(t["depends"], [])
        self.assertEqual(t["prd_ref"], "공통 (BPA 외)")
        self.assertIsNone(t["entry_point"])
        self.assertEqual(t["acceptance"], ["dev 서버 기동", "헬스체크 통과"])

    def test_task_spec_sections(self):
        by_id = {n["id"]: n for n in wbs_parse.parse_nodes(FOURLEVEL, "")}
        s1 = by_id["TSK-00-01-01"]["spec_sections"]
        self.assertEqual(s1["requirements"], ["프로젝트 생성, env 배선", "CI 파이프라인"])
        self.assertEqual(s1["test_criteria"], [])
        self.assertEqual(s1["constraints"], [])
        self.assertIsNone(s1["api_spec"])
        self.assertIsNone(s1["data_model"])
        self.assertIsNone(s1["description"])

        s2 = by_id["TSK-00-01-02"]["spec_sections"]
        self.assertEqual(s2["constraints"], ["모듈 전용 엔티티 금지"])
        self.assertEqual(s2["test_criteria"], ["단위: 전이 / E2E: 수신 3유형"])
        self.assertEqual(s2["api_spec"],
                         "`confirmReceiving(lotId)` — 단일 트랜잭션 RPC")
        self.assertEqual(s2["data_model"], "common_code(그룹, 코드, 명칭)")

    def test_second_task_fields(self):
        by_id = {n["id"]: n for n in wbs_parse.parse_nodes(FOURLEVEL, "")}
        t = by_id["TSK-00-01-02"]
        self.assertEqual(t["assignee"], "lee@example.com")
        self.assertEqual(t["depends"], ["TSK-00-01-01"])
        self.assertEqual(t["model"], "opus")
        self.assertEqual(t["stage"], "im")
        self.assertEqual(t["entry_point"], "layout (전 화면 공통 셸)")

    def test_empty_tags_sentinel(self):
        by_id = {n["id"]: n for n in wbs_parse.parse_nodes(FOURLEVEL, "")}
        self.assertEqual(by_id["TSK-01-01-01"]["tags"], [])

    def test_non_task_nodes_are_blank_but_present(self):
        by_id = {n["id"]: n for n in wbs_parse.parse_nodes(FOURLEVEL, "")}
        act = by_id["ACT-00-01"]
        self.assertIsNone(act["stage"])
        self.assertEqual(act["tags"], [])
        self.assertEqual(act["acceptance"], [])
        self.assertIsNone(act["spec_sections"]["api_spec"])
        wp = by_id["WP-01"]
        self.assertIsNone(wp["stage"])
        self.assertIsNone(wp["spec_sections"]["description"])


class ParseNodesStage(unittest.TestCase):
    def test_local_cycle_states_map_to_dflow_stage(self):
        by_id = {n["id"]: n for n in wbs_parse.parse_nodes(FOURLEVEL, "")}
        self.assertEqual(by_id["TSK-01-01-01"]["stage"], "ip")   # [ts] → ip
        by3 = {n["id"]: n for n in wbs_parse.parse_nodes(THREELEVEL, "")}
        self.assertEqual(by3["TSK-00-01"]["stage"], "ip")        # [dd] → ip

    def test_state_json_overrides_wbs_status(self):
        with tempfile.TemporaryDirectory() as tmp:
            wbs = _docs(pathlib.Path(tmp), FOURLEVEL)
            task_dir = wbs.parent / "tasks" / "TSK-00-01-01"
            task_dir.mkdir(parents=True)
            (task_dir / "state.json").write_text(
                json.dumps({"status": "[xx]"}), encoding="utf-8")
            by_id = {n["id"]: n
                     for n in wbs_parse.parse_nodes(FOURLEVEL, str(wbs.parent))}
            self.assertEqual(by_id["TSK-00-01-01"]["stage"], "xx")


if __name__ == "__main__":
    unittest.main()
```

- [ ] 실패를 확인한다: `python3 -m pytest scripts/test_wbs_parse_export.py -q`
      → 기대: `AttributeError: module 'wbs_parse' has no attribute 'parse_nodes'` (11 errors)
- [ ] `scripts/wbs-parse.py` 의 import 블록(7-10행) 뒤에 추가한다:

```python
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _wbs_status  # noqa: E402
```

- [ ] `parse_tasks_from_wp`(192-230) 아래에 추가한다:

```python
# --- 전 계층 export (D'Flow /wbs/import 계약 v2) ---

_SPEC_KEYS = ("requirements", "test_criteria", "constraints",
              "api_spec", "data_model", "description")

_WP_HEADING_RE = re.compile(r'^##\s+(WP-\d+):\s*(.*)$')
_ACT_HEADING_RE = re.compile(r'^###\s+(ACT-\d+(?:-\d+)+):\s*(.*)$')
_TSK_HEADING_RE = re.compile(r'^#{3,5}\s+(TSK-\d+(?:-\d+)+):\s*(.*)$')


def _nullify(value):
    """'-' 와 빈 문자열을 None 으로 접는다 (wbs.md 의 '값 없음' 센티널)."""
    v = (value or "").strip()
    if not v or v == "-":
        return None
    return v


def _csv_field(block: str, field_name: str) -> list:
    """쉼표 구분 스칼라 필드를 배열로 편다 (tags). '-' 는 []."""
    raw = _nullify(get_field(block, field_name))
    if raw is None:
        return []
    return [s.strip() for s in raw.split(",") if s.strip()]


def _join_or_none(items: list):
    """불릿 리스트를 개행으로 이은 문자열. 비면 None (계약 v2 의 string|null)."""
    if not items:
        return None
    return "\n".join(items)


def _blank_spec_sections() -> dict:
    return {
        "requirements": [],
        "test_criteria": [],
        "constraints": [],
        "api_spec": None,
        "data_model": None,
        "description": None,
    }


def _blank_node(node_id: str, kind: str, title: str, parent_id) -> dict:
    """계약 v2 의 17키를 전부 가진 빈 노드. 모든 kind 가 같은 shape 을 쓴다."""
    return {
        "id": node_id,
        "parent_id": parent_id,
        "kind": kind,
        "title": title.strip(),
        "stage": None,
        "category": None,
        "domain": None,
        "model": None,
        "assignee": None,
        "schedule": None,
        "priority": None,
        "tags": [],
        "depends": [],
        "prd_ref": None,
        "entry_point": None,
        "acceptance": [],
        "spec_sections": _blank_spec_sections(),
    }


def parse_nodes(wbs_text: str, docs_dir: str) -> list:
    """WBS 전 계층(Phase/WP/ACT/Task)을 계약 v2 노드 배열로 파싱한다.

    Phase 노드는 WP 의 ``- phase:`` 값에서 최초 등장 순서로 합성한다 —
    wbs.md 에 Phase 이름 표기가 없으므로 title 은 id 와 같다.
    Task 의 상태는 state.json 이 있으면 그 값이 진실 원천이며, 출력에는
    대괄호 표기가 아니라 D'Flow stage 코드만 싣는다.
    """
    lines = wbs_text.splitlines()
    phases: list = []
    wps: list = []
    acts: list = []
    tasks: list = []

    current_wp = None
    current_act = None

    for idx, line in enumerate(lines):
        m = _WP_HEADING_RE.match(line)
        if m:
            wp_id, title = m.group(1), m.group(2)
            # WP 메타는 다음 헤딩 전까지
            meta_lines = []
            for nxt in lines[idx + 1:]:
                if nxt.startswith("#"):
                    break
                meta_lines.append(nxt)
            meta = "\n".join(meta_lines)
            phase_id = _nullify(get_field(meta, "phase"))
            if phase_id and phase_id not in phases:
                phases.append(phase_id)
            node = _blank_node(wp_id, "wp", title, phase_id)
            node["schedule"] = _nullify(get_field(meta, "schedule"))
            node["spec_sections"]["description"] = _nullify(
                get_field(meta, "description"))
            wps.append(node)
            current_wp = wp_id
            current_act = None
            continue

        m = _ACT_HEADING_RE.match(line)
        if m:
            act_id, title = m.group(1), m.group(2)
            acts.append(_blank_node(act_id, "act", title, current_wp))
            current_act = act_id
            continue

        m = _TSK_HEADING_RE.match(line)
        if m:
            tsk_id, title = m.group(1), m.group(2)
            block = extract_task_block(wbs_text, tsk_id)
            status = get_field(block, "status") or "[ ]"
            if docs_dir:
                state_data = _load_task_state_json(docs_dir, tsk_id)
                if state_data and state_data.get("status"):
                    status = state_data["status"]
            node = _blank_node(tsk_id, "task", title, current_act or current_wp)
            node["stage"] = _wbs_status.stage_code(status)
            node["category"] = _nullify(get_field(block, "category"))
            node["domain"] = _nullify(get_field(block, "domain"))
            node["model"] = _nullify(get_field(block, "model"))
            node["assignee"] = _nullify(get_field(block, "assignee"))
            node["schedule"] = _nullify(get_field(block, "schedule"))
            node["priority"] = _nullify(get_field(block, "priority"))
            node["tags"] = _csv_field(block, "tags")
            node["depends"] = parse_list_field(block, "depends")
            node["prd_ref"] = _nullify(get_field(block, "prd-ref"))
            node["entry_point"] = _nullify(get_field(block, "entry-point"))
            node["acceptance"] = parse_list_field(block, "acceptance")
            node["spec_sections"] = {
                "requirements": parse_list_field(block, "requirements"),
                "test_criteria": parse_list_field(block, "test-criteria"),
                "constraints": parse_list_field(block, "constraints"),
                "api_spec": _join_or_none(parse_list_field(block, "api-spec")),
                "data_model": _join_or_none(parse_list_field(block, "data-model")),
                "description": _nullify(get_field(block, "description")),
            }
            tasks.append(node)
            continue

    phase_nodes = [_blank_node(p, "phase", p, None) for p in phases]
    return phase_nodes + wps + acts + tasks
```

> `_ACT_HEADING_RE` 를 `_TSK_HEADING_RE` 보다 먼저 검사한다 — 3단계 문서에서는 둘 다 `###` 로 시작한다.
> 위 루프가 WP → ACT → TSK 순으로 검사하므로 순서가 이미 보장된다.

- [ ] 통과를 확인한다: `python3 -m pytest scripts/test_wbs_parse_export.py -q` → 기대: `11 passed`
- [ ] 회귀 세트 초록 확인 (`--tasks-all`·`--json` 등 기존 모드는 건드리지 않았다).
- [ ] 커밋: `git add scripts/wbs-parse.py scripts/test_wbs_parse_export.py && git commit -m "feat(parse): 전 계층 노드 파서(계약 v2) — Phase/WP/ACT 를 파싱하는 코드가 아예 없었다"`

---

### Task 3: wbs-parse — `--export` CLI + 계약 v2 동결 (DEV-02)

**Files**
- Modify: `scripts/wbs-parse.py` (USAGE 12-46, `main` 의 `--tasks-all` 분기 862-874 뒤에 신규 분기)
- Modify: `scripts/test_wbs_parse_export.py` (CLI·봉투 테스트 추가)

**Interfaces**

Produces — CLI:
```
wbs-parse.py <wbs-path> --export
```
출력 봉투 (`POST /api/v1/wbs/import` 요청 본문은 이 객체에 `project_id`·`module` 을 더한 것이다):

```json
{
  "schema_version": "2.0",
  "source": "docs/MOD/wbs.md",
  "nodes": [ /* Task 2 의 17키 노드 */ ]
}
```
- `generated_at` 같은 **비결정 필드를 넣지 않는다** (diff·골든 테스트가 깨진다).
- `source` 는 인자로 받은 경로를 그대로 싣는다.
- `schema_version` 은 `"2.0"` — 계약 v2 임을 임포터가 확인할 수 있게 한다.

Consumes: `parse_nodes(wbs_text, docs_dir)` (Task 2)

**Steps**

- [ ] `scripts/test_wbs_parse_export.py` 에 추가한다:

```python
class ExportCLI(unittest.TestCase):
    def _run(self, args):
        return subprocess.run([sys.executable, str(_MODULE_PATH), *args],
                              capture_output=True, text=True)

    def test_export_envelope(self):
        with tempfile.TemporaryDirectory() as tmp:
            wbs = _docs(pathlib.Path(tmp), FOURLEVEL)
            r = self._run([str(wbs), "--export"])
            self.assertEqual(r.returncode, 0, r.stderr)
            out = json.loads(r.stdout)
            self.assertEqual(out["schema_version"], "2.0")
            self.assertEqual(out["source"], str(wbs))
            self.assertNotIn("generated_at", out)
            self.assertEqual(len(out["nodes"]), 9)   # 2 phase + 2 wp + 2 act + 3 task

    def test_export_node_keys_match_contract(self):
        with tempfile.TemporaryDirectory() as tmp:
            wbs = _docs(pathlib.Path(tmp), FOURLEVEL)
            out = json.loads(self._run([str(wbs), "--export"]).stdout)
            for n in out["nodes"]:
                self.assertEqual(set(n.keys()), NODE_KEYS, n["id"])
                self.assertEqual(set(n["spec_sections"].keys()), SPEC_KEYS, n["id"])

    def test_export_is_deterministic(self):
        with tempfile.TemporaryDirectory() as tmp:
            wbs = _docs(pathlib.Path(tmp), FOURLEVEL)
            a = self._run([str(wbs), "--export"]).stdout
            b = self._run([str(wbs), "--export"]).stdout
            self.assertEqual(a, b)

    def test_export_uses_stage_codes_not_brackets(self):
        with tempfile.TemporaryDirectory() as tmp:
            wbs = _docs(pathlib.Path(tmp), FOURLEVEL)
            raw = self._run([str(wbs), "--export"]).stdout
            stages = {n["stage"] for n in json.loads(raw)["nodes"]
                      if n["kind"] == "task"}
            self.assertEqual(stages, {"todo", "im", "ip"})
            # 대괄호 표기는 wbs.md 표면 한정 — 계약에는 stage 코드만 나간다
            for bracket in ("[ ]", "[as]", "[fp]", "[ip]", "[im]", "[ts]", "[dd]", "[xx]"):
                self.assertNotIn(bracket, raw)

    def test_export_parent_graph_is_closed(self):
        """모든 parent_id 가 노드 집합 안에 있고, 고아는 phase 뿐이다."""
        with tempfile.TemporaryDirectory() as tmp:
            wbs = _docs(pathlib.Path(tmp), FOURLEVEL)
            nodes = json.loads(self._run([str(wbs), "--export"]).stdout)["nodes"]
            ids = {n["id"] for n in nodes}
            for n in nodes:
                if n["parent_id"] is None:
                    self.assertEqual(n["kind"], "phase", n["id"])
                else:
                    self.assertIn(n["parent_id"], ids, n["id"])

    def test_export_three_level(self):
        with tempfile.TemporaryDirectory() as tmp:
            wbs = _docs(pathlib.Path(tmp), THREELEVEL)
            out = json.loads(self._run([str(wbs), "--export"]).stdout)
            self.assertEqual(len(out["nodes"]), 3)   # 1 phase + 1 wp + 1 task

    def test_export_missing_file(self):
        r = self._run(["/nonexistent/wbs.md", "--export"])
        self.assertEqual(r.returncode, 1)
```

- [ ] 실패를 확인한다: `python3 -m pytest scripts/test_wbs_parse_export.py -k ExportCLI -q`
      → 기대: `--export` 가 미지원 모드라 USAGE 출력 + exit 1, `json.loads` 가 JSONDecodeError
- [ ] `scripts/wbs-parse.py` 의 USAGE Modes 목록(15-26)에 추가한다:

```
  --export               전 계층(Phase/WP/ACT/Task)·전 필드 JSON — D'Flow 업로드 계약 v2
```

  그리고 Examples 목록(34-45)에 `wbs-parse.py docs/wbs.md --export` 를 더한다.

- [ ] `main` 의 `--tasks-all` 분기(862-874) 뒤에 새 분기를 넣는다:

```python
    # -- 전 계층 export (D'Flow /wbs/import 계약 v2) --
    elif mode == "--export":
        docs_dir = os.path.dirname(os.path.abspath(wbs_path))
        nodes = parse_nodes(wbs_text, docs_dir)
        print(json.dumps({
            "schema_version": "2.0",
            "source": wbs_path,
            "nodes": nodes,
        }, ensure_ascii=False, indent=2))
```

- [ ] 통과를 확인한다: `python3 -m pytest scripts/test_wbs_parse_export.py -q` → 기대: `18 passed` (Task 2 의 11 + ExportCLI 7)
- [ ] 실물로 수동 확인한다 (테스트에는 넣지 않는다 — 리포 밖 경로):
      ```bash
      python3 scripts/wbs-parse.py /Users/jji/project/dev-workflow/docs/MES/wbs.md --export \
        | python3 -c "import json,sys,collections; d=json.load(sys.stdin); \
          print(d['schema_version'], len(d['nodes']), collections.Counter(n['kind'] for n in d['nodes']))"
      ```
      → 기대: `2.0 67 Counter({'task': 40, 'act': 18, 'wp': 6, 'phase': 3})`
      ```bash
      python3 scripts/wbs-parse.py /Users/jji/project/dev-workflow/docs/bookloop/wbs.md --export \
        | python3 -c "import json,sys,collections; d=json.load(sys.stdin); \
          print(d['schema_version'], len(d['nodes']), collections.Counter(n['kind'] for n in d['nodes']))"
      ```
      → 기대: `2.0 23 Counter({'task': 13, 'wp': 7, 'phase': 3})`
- [ ] 커밋: `git add scripts/wbs-parse.py scripts/test_wbs_parse_export.py && git commit -m "feat(parse): --export 신설 — 목록 모드 6필드로는 D'Flow 부트스트랩 import 를 채울 수 없다"`

---

### Task 4: wbs-validate — 3세그먼트 TSK + 블록 경계 (DEV-03)

**Files**
- Modify: `scripts/wbs-validate.py` (`TASK_HEADING_RE` 39, `_split_tasks` 56-72)
- Modify: `scripts/test_wbs_validate.py` (4단계 케이스 추가)

**Interfaces**

Produces (동일 정규식·경계 규칙을 Task 5 가 그대로 쓴다):
```python
TASK_HEADING_RE = re.compile(
    r"^(?P<level>#{3,5})\s+(?P<id>TSK-\d+(?:-\d+)+):\s*(?P<title>.*)$", re.MULTILINE)
HEADING_RE = re.compile(r"^(#{1,6})\s", re.MULTILINE)
```
**블록 경계 규칙**: Task 블록은 `다음 Task 헤딩` 또는 `레벨 ≤ 자기 레벨인 임의의 헤딩` 에서 끝난다.
- MES(4단): Task `####`(4) · 하위 절 `#####`(5) → 5 > 4 이므로 닫지 않음 · `### ACT-`(3) ≤ 4 → 닫음
- bookloop(3단): Task `###`(3) · 하위 절 `####`(4) → 4 > 3 이므로 닫지 않음 · `## WP-`(2) ≤ 3 → 닫음

`validate_wbs` 반환 shape 무변경.

**현상**: MES 40 Task 가 `task_count: 0` · `ok: true` 로 읽힌다 (실측). 부트스트랩 import 직전
검증이 통째로 무력화되므로 잘못된 WBS 가 그대로 D'Flow 로 들어간다.

**Steps**

- [ ] `scripts/test_wbs_validate.py` 에 4단계 픽스처와 테스트를 추가한다 (기존 `CLEAN_WBS` 등은 그대로 둔다):

```python
FOURLEVEL_WBS = """\
# WBS

## WP-00: 초기화
- phase: PH-1

### ACT-00-01: 공통 기반

전 모듈이 공유하는 기술 기반.

#### TSK-00-01-01: 스캐폴드
- domain: backend
- depends: -
- status: [ ]
- acceptance: 헬스체크 200ms 이하 통과

##### PRD 요구사항
- requirements:
  - 프로젝트 생성

#### TSK-00-01-02: 시드
- domain: backend
- depends: TSK-00-01-01
- status: [ ]
- acceptance: 시드 3건 적재 확인

## WP-01: 기능
- phase: PH-2

### ACT-01-01: 로그인

#### TSK-01-01-01: 로그인 API
- domain: backend
- depends: TSK-00-01-02
- status: [ ]
- acceptance: 응답 200ms 이하
"""


class TestFourLevelWBS(unittest.TestCase):
    """DEV-03: 4단계(ACT) WBS 가 0건으로 읽히며 ok:true 가 나오던 회귀."""

    def test_four_level_tasks_are_detected(self):
        blocks = wbs_validate._split_tasks(FOURLEVEL_WBS)
        self.assertEqual(
            [b["id"] for b in blocks],
            ["TSK-00-01-01", "TSK-00-01-02", "TSK-01-01-01"],
        )

    def test_block_stops_at_lower_or_equal_heading(self):
        blocks = {b["id"]: b["block"] for b in wbs_validate._split_tasks(FOURLEVEL_WBS)}
        first = blocks["TSK-00-01-01"]
        self.assertIn("##### PRD 요구사항", first)      # 하위 절은 포함
        self.assertNotIn("TSK-00-01-02", first)        # 다음 Task 는 제외
        last = blocks["TSK-00-01-02"]
        self.assertNotIn("## WP-01", last)             # 상위 헤딩에서 닫힘
        self.assertNotIn("ACT-01-01", last)

    def test_depends_resolve_across_acts(self):
        result = wbs_validate.validate_wbs(FOURLEVEL_WBS)
        self.assertEqual(result["summary"]["task_count"], 3)
        self.assertEqual(
            [i for i in result["issues"] if i["type"] == "depends_unknown"], [])

    def test_three_level_block_no_longer_swallows_wp_heading(self):
        blocks = {b["id"]: b["block"] for b in wbs_validate._split_tasks(CLEAN_WBS)}
        self.assertNotIn("## WP-", blocks["TSK-01-02"])
```

- [ ] 실패를 확인한다: `python3 -m pytest scripts/test_wbs_validate.py -q`
      → 기대: `test_four_level_tasks_are_detected` 가 `[] != [...]` 로 실패(2세그먼트 정규식이 0건),
      나머지 3개도 KeyError 로 실패
- [ ] `scripts/wbs-validate.py` 의 39행을 교체한다:

```python
# Task 헤딩: 3단계 `### TSK-XX-YY:` / 4단계 `#### TSK-XX-YY-ZZ:` 겸용.
# 세그먼트 수를 고정하지 않는다 — ACT 계층이 들어가면 세그먼트가 하나 는다.
TASK_HEADING_RE = re.compile(
    r"^(?P<level>#{3,5})\s+(?P<id>TSK-\d+(?:-\d+)+):\s*(?P<title>.*)$", re.MULTILINE)

# 블록 경계 계산용 — 모든 헤딩의 위치와 레벨
HEADING_RE = re.compile(r"^(#{1,6})\s", re.MULTILINE)
```

- [ ] `_split_tasks`(56-72)를 교체한다:

```python
def _split_tasks(content: str) -> list[dict]:
    """wbs.md를 Task 블록 리스트로 분리.

    블록은 '레벨이 자기 이하인 다음 헤딩' 에서 끝난다. 4단계 WBS 에서 Task 는
    `####`, 하위 절은 `#####` 이므로 하위 절은 블록 안에 남고 `### ACT-`·`## WP-`
    는 블록을 닫는다.
    """
    matches = list(TASK_HEADING_RE.finditer(content))
    headings = [(m.start(), len(m.group(1))) for m in HEADING_RE.finditer(content)]
    blocks: list[dict] = []
    for m in matches:
        start = m.start()
        level = len(m.group("level"))
        end = len(content)
        for pos, hl in headings:
            if pos > start and hl <= level:
                end = pos
                break
        blocks.append({
            "id": m.group("id"),
            "title": m.group("title").strip(),
            "line": content[:start].count("\n") + 1,
            "block": content[start:end],
        })
    return blocks
```

- [ ] 통과를 확인한다: `python3 -m pytest scripts/test_wbs_validate.py -q` → 기대: `22 passed` (기존 18 + 신규 4)
- [ ] 실물 MES WBS 로 수동 확인한다 (테스트에는 넣지 않는다 — 리포 밖 경로):
      ```bash
      python3 scripts/wbs-validate.py validate \
        --wbs /Users/jji/project/dev-workflow/docs/MES/wbs.md | head -12
      ```
      → 기대: `"task_count": 40` (수정 전에는 `0` 이고 `"ok": true` 였다)
- [ ] 회귀 세트 초록 확인.
- [ ] 커밋: `git add scripts/wbs-validate.py scripts/test_wbs_validate.py && git commit -m "fix(validate): 4단계 ACT WBS 를 0건으로 읽고 ok:true 를 내던 정규식 정정 — 부트스트랩 import 직전 검증이 무력화됐다"`

---

### Task 5: merge-wbs-status — 3세그먼트 TSK 헤딩 + 블록 경계 (DEV-03)

**Files**
- Modify: `scripts/merge-wbs-status.py` (`TASK_HEADER_RE` 37, `parse_status_lines` 73-95, `_reapply_statuses` 126-156, 모듈 docstring 7-17)
- Modify: `scripts/test_merge_wbs_status.py` (4단계 케이스 추가)

**Interfaces**

Consumes: Task 4 와 **같은 경계 규칙** (다음 TSK 헤딩 또는 레벨 ≤ 자기 레벨인 헤딩에서 닫힘).

Produces:
```python
TASK_HEADER_RE = re.compile(r"^(?P<level>#{3,5})\s+(?P<id>TSK-\d+(?:-\d+)+):")
HEADING_RE = re.compile(r"^(#{1,6})\s")
parse_status_lines(text: str) -> dict[str, str]      # shape 무변경
```

**`STATUS_PRIORITY`(28-34)와 `STATUS_LINE_RE`(38-40)는 5상태 그대로 둔다.** 로컬 `wbs.md` 는
5상태 사이클로 계속 돌기 때문이다(6상태 어휘 확장은 부록 A-4 로 스코프 아웃).

**왜 은퇴 예정 파일에 이 수정이 필요한가**: 부트스트랩 import 이전, 즉 `wbs.md` 를 여러 명이
작성·검수하는 구간은 실제로 존재한다. 지금 4단계 문서에서는 `TASK_HEADER_RE` 가 아무 Task 도
잡지 못해 **모든 status 줄이 고아 placeholder 가 되고 `_reapply_statuses` 가 전부 `[ ]` 로 덮어쓴다**
— 조용한 데이터 손실이다.

**Steps**

- [ ] `scripts/test_merge_wbs_status.py` 에 추가한다:

```python
def _fourlevel_wbs(status_a: str, status_b: str) -> str:
    return (
        "# WBS\n\n"
        "## WP-00: init\n"
        "- phase: PH-1\n\n"
        "### ACT-00-01: base\n\n"
        "#### TSK-00-01-01: a\n"
        "- category: infra\n"
        f"- status: {status_a}\n\n"
        "##### PRD 요구사항\n"
        "- requirements:\n"
        "  - x\n\n"
        "#### TSK-00-01-02: b\n"
        "- category: infra\n"
        f"- status: {status_b}\n"
    )


def _load_driver():
    import importlib.util
    spec = importlib.util.spec_from_file_location("merge_wbs_status", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class MergeWbsStatusFourLevelTests(unittest.TestCase):
    """DEV-03: 4단계 ACT WBS 에서 머지 드라이버가 무력화되던 회귀."""

    def test_parse_status_lines_reads_four_level_tasks(self) -> None:
        got = _load_driver().parse_status_lines(_fourlevel_wbs("[dd]", "[ ]"))
        self.assertEqual(got, {"TSK-00-01-01": "[dd]", "TSK-00-01-02": "[ ]"})

    def test_four_level_priority_merge(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            td_p = pathlib.Path(td)
            base = td_p / "base.md"
            ours = td_p / "ours.md"
            theirs = td_p / "theirs.md"
            base.write_text(_fourlevel_wbs("[ ]", "[ ]"), encoding="utf-8")
            ours.write_text(_fourlevel_wbs("[dd]", "[ ]"), encoding="utf-8")
            theirs.write_text(_fourlevel_wbs("[im]", "[ ]"), encoding="utf-8")
            res = _run_driver(base, ours, theirs)
            self.assertEqual(res.returncode, 0, res.stderr)
            merged = ours.read_text(encoding="utf-8")
            self.assertIn("#### TSK-00-01-01: a", merged)
            self.assertIn("- status: [im]", merged)
            self.assertIn("##### PRD 요구사항", merged)

    def test_four_level_second_task_status_not_clobbered(self) -> None:
        """고아 placeholder → [ ] 덮어쓰기(조용한 데이터 손실) 재현·방지."""
        with tempfile.TemporaryDirectory() as td:
            td_p = pathlib.Path(td)
            base = td_p / "base.md"
            ours = td_p / "ours.md"
            theirs = td_p / "theirs.md"
            base.write_text(_fourlevel_wbs("[ ]", "[dd]"), encoding="utf-8")
            ours.write_text(_fourlevel_wbs("[dd]", "[xx]"), encoding="utf-8")
            theirs.write_text(_fourlevel_wbs("[im]", "[dd]"), encoding="utf-8")
            res = _run_driver(base, ours, theirs)
            self.assertEqual(res.returncode, 0, res.stderr)
            merged = ours.read_text(encoding="utf-8")
            self.assertIn("- status: [im]", merged)
            self.assertIn("- status: [xx]", merged)   # 두 번째 Task 가 살아 있다

    def test_subsection_does_not_close_task_block(self) -> None:
        text = (
            "# WBS\n\n"
            "#### TSK-00-01-01: a\n"
            "##### PRD 요구사항\n"
            "- status: [im]\n"
        )
        # 하위 절(#####)이 블록을 닫지 않으므로 그 아래 status 줄도 이 Task 것이다.
        self.assertEqual(_load_driver().parse_status_lines(text),
                         {"TSK-00-01-01": "[im]"})
```

- [ ] 실패를 확인한다: `python3 -m pytest scripts/test_merge_wbs_status.py -q`
      → 기대: `test_parse_status_lines_reads_four_level_tasks` 가 `{} != {...}` 로 실패,
      `test_four_level_second_task_status_not_clobbered` 가 `- status: [xx]` 부재로 실패
- [ ] `scripts/merge-wbs-status.py` 의 37행을 교체한다:

```python
# Task 헤딩: 3단계 `### TSK-XX-YY:` / 4단계 `#### TSK-XX-YY-ZZ:` 겸용.
TASK_HEADER_RE = re.compile(r"^(?P<level>#{3,5})\s+(?P<id>TSK-\d+(?:-\d+)+):")
HEADING_RE = re.compile(r"^(#{1,6})\s")
```

- [ ] `parse_status_lines`(73-95)를 교체한다:

```python
def parse_status_lines(text: str) -> dict[str, str]:
    """task_id → status 매핑.

    Task 블록은 '레벨이 자기 이하인 다음 헤딩' 에서 닫힌다. 4단계 WBS 의
    하위 절(`##### PRD 요구사항`)은 블록을 닫지 않고, `### ACT-`·`## WP-` 는 닫는다.
    중복 task_id 는 첫 값을 유지한다.
    """
    out: dict[str, str] = {}
    current_task: str | None = None
    current_level = 0
    for line in text.splitlines():
        m = TASK_HEADER_RE.match(line)
        if m:
            current_task = m.group("id")
            current_level = len(m.group("level"))
            continue
        h = HEADING_RE.match(line)
        if h and current_task is not None and len(h.group(1)) <= current_level:
            current_task = None
            continue
        if current_task is None:
            continue
        sm = STATUS_LINE_RE.match(line)
        if sm and current_task not in out:
            out[current_task] = sm.group("status")
    return out
```

- [ ] `_reapply_statuses`(126-156)의 블록 추적을 같은 규칙으로 교체한다:

```python
def _reapply_statuses(text: str, statuses: dict[str, str]) -> str:
    """STATUS_TOKEN 을 해소된 상태로 되돌린다 (parse_status_lines 와 같은 경계 규칙)."""
    lines = text.splitlines(keepends=True)
    out: list[str] = []
    current_task: str | None = None
    current_level = 0
    applied: set[str] = set()
    for line in lines:
        stripped = line.rstrip("\r\n")
        header_match = TASK_HEADER_RE.match(stripped)
        if header_match:
            current_task = header_match.group("id")
            current_level = len(header_match.group("level"))
            out.append(line)
            continue
        h = HEADING_RE.match(stripped)
        if h and current_task is not None and len(h.group(1)) <= current_level:
            current_task = None
            out.append(line)
            continue
        if STATUS_TOKEN in line and current_task is not None and current_task not in applied:
            resolved = statuses.get(current_task, "[ ]")
            out.append(line.replace(STATUS_TOKEN, resolved, 1))
            applied.add(current_task)
            continue
        # 고아 placeholder (매칭 Task 없음 또는 이미 적용) — [ ] 로 둔다
        if STATUS_TOKEN in line:
            out.append(line.replace(STATUS_TOKEN, "[ ]", 1))
            continue
        out.append(line)
    return "".join(out)
```

- [ ] 모듈 docstring(7-17행)의 알고리즘 설명에서 `### TSK-XX-XX:` 를
      `### / #### TSK-…` (3~4단계 겸용) 로 고친다.
- [ ] 통과를 확인한다: `python3 -m pytest scripts/test_merge_wbs_status.py -q`
      → 기대: 전부 초록 (기존 전건 + 신규 4건). 특히 트립와이어 `test_merge_wbs_status_priority`.
- [ ] 실물로 수동 확인한다:
      ```bash
      python3 -c "
      import importlib.util, pathlib
      s = importlib.util.spec_from_file_location('m', 'scripts/merge-wbs-status.py')
      m = importlib.util.module_from_spec(s); s.loader.exec_module(m)
      for p in ('/Users/jji/project/dev-workflow/docs/MES/wbs.md',
                '/Users/jji/project/dev-workflow/docs/bookloop/wbs.md'):
          print(p, len(m.parse_status_lines(pathlib.Path(p).read_text())))
      "
      ```
      → 기대: MES `40`, bookloop `13` (수정 전에는 MES 가 `0`)
- [ ] 회귀 세트 초록 확인.
- [ ] 커밋: `git add scripts/merge-wbs-status.py scripts/test_merge_wbs_status.py && git commit -m "fix(merge): 4단계 ACT WBS 의 Task 헤딩·블록 경계 인식 — status 줄이 전부 고아가 되어 [ ] 로 덮어쓰이던 손실"`

---

### Task 6: dep-analysis — 의존 충족 임계 `[im]` (부트스트랩 전 로컬 검증)

**Files**
- Modify: `scripts/dep-analysis.py` (USAGE 19-62, `main` 322-329 플래그 파싱, 완료 판정 388, 결과 dict 453-459)
- Create: `scripts/test_dep_analysis_threshold.py`

**Interfaces**

Produces — CLI 추가:
```
dep-analysis.py [input-file] [--graph-stats] [--docs-dir DIR]
```
`--docs-dir` 를 주면 상태머신을 해석해 충족 상태 집합을 결정한다(6상태 정의 → `{[im],[xx]}`, 5상태 → `{[xx]}`).
**주지 않으면 현행 그대로 `[xx]` 단독** — 기존 호출자는 영향이 없다.
기본 모드 출력에 `"satisfied_states": ["[im]","[xx]"]` 를 추가해 어떤 임계로 계산했는지 드러낸다.

Consumes: `_wbs_status.resolve_state_machine(docs_dir)` · `_wbs_status.satisfied_states(sm)`

**비중**: 부트스트랩 import **전** 로컬 WBS 의 의존 그래프를 점검할 때만 쓴다. import 후 스케줄링의
정본은 D'Flow 다. 문서(`[im]` 이상)와 코드(`[xx]` 단독)의 불일치(F3)를 해소하는 것이 이 task 의 목적이다.

**Steps**

- [ ] `scripts/test_dep_analysis_threshold.py` 를 작성한다:

```python
#!/usr/bin/env python3
"""dep-analysis.py — 의존 충족 임계 테스트 (F3: 문서 [im] vs 코드 [xx])."""
from __future__ import annotations

import json
import pathlib
import subprocess
import sys
import tempfile
import unittest

SCRIPT = pathlib.Path(__file__).resolve().parent / "dep-analysis.py"

V6_SM = {
    "states": {"[ ]": {}, "[as]": {}, "[fp]": {}, "[ip]": {}, "[im]": {}, "[xx]": {}},
    "transitions": {}, "events": {},
}

TASKS = [
    {"tsk_id": "TSK-01-01", "status": "[im]", "depends": "-"},
    {"tsk_id": "TSK-01-02", "status": "[ ]", "depends": "TSK-01-01"},
]


def _run(args, stdin_text) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, str(SCRIPT), *args],
                          input=stdin_text, capture_output=True, text=True)


class DependencyThreshold(unittest.TestCase):
    def test_default_keeps_xx_only(self):
        """플래그 없으면 현행 그대로 — [im] 은 미완이라 후행이 level 1 로 밀린다."""
        r = _run(["-"], json.dumps(TASKS))
        self.assertEqual(r.returncode, 0, r.stderr)
        out = json.loads(r.stdout)
        self.assertEqual(out["completed"], [])
        self.assertEqual(out["levels"]["0"], ["TSK-01-01"])
        self.assertEqual(out["levels"]["1"], ["TSK-01-02"])
        self.assertEqual(out["satisfied_states"], ["[xx]"])

    def test_docs_dir_v6_treats_im_as_satisfied(self):
        with tempfile.TemporaryDirectory() as tmp:
            docs = pathlib.Path(tmp) / "docs"
            (docs / "MOD").mkdir(parents=True)
            (docs / "state-machine.json").write_text(
                json.dumps(V6_SM), encoding="utf-8")
            r = _run(["-", "--docs-dir", str(docs / "MOD")], json.dumps(TASKS))
            self.assertEqual(r.returncode, 0, r.stderr)
            out = json.loads(r.stdout)
            self.assertEqual(out["completed"], ["TSK-01-01"])
            self.assertEqual(out["levels"]["0"], ["TSK-01-02"])
            self.assertEqual(sorted(out["satisfied_states"]), ["[im]", "[xx]"])

    def test_docs_dir_5state_keeps_xx_only(self):
        with tempfile.TemporaryDirectory() as tmp:
            sub = pathlib.Path(tmp) / "a" / "b"
            sub.mkdir(parents=True)
            r = _run(["-", "--docs-dir", str(sub)], json.dumps(TASKS))
            self.assertEqual(r.returncode, 0, r.stderr)
            out = json.loads(r.stdout)
            self.assertEqual(out["completed"], [])
            self.assertEqual(out["satisfied_states"], ["[xx]"])

    def test_missing_docs_dir_argument_is_an_error(self):
        r = _run(["-", "--docs-dir"], json.dumps(TASKS))
        self.assertEqual(r.returncode, 1)

    def test_bypassed_still_satisfies(self):
        tasks = [
            {"tsk_id": "TSK-01-01", "status": "[dd]", "depends": "-", "bypassed": True},
            {"tsk_id": "TSK-01-02", "status": "[ ]", "depends": "TSK-01-01"},
        ]
        r = _run(["-"], json.dumps(tasks))
        out = json.loads(r.stdout)
        self.assertEqual(out["completed"], ["TSK-01-01"])


if __name__ == "__main__":
    unittest.main()
```

- [ ] 실패를 확인한다: `python3 -m pytest scripts/test_dep_analysis_threshold.py -q`
      → 기대: `--docs-dir` 미지원으로 `ERROR: file not found: --docs-dir` (exit 1) 및
      `satisfied_states` 키 부재로 KeyError
- [ ] `scripts/dep-analysis.py` 의 import 블록(13-17행) 뒤에 추가한다:

```python
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _wbs_status  # noqa: E402
```

- [ ] `main`(322-329)의 플래그 파싱을 교체한다:

```python
def main():
    # Parse flags
    args = list(sys.argv[1:])
    graph_stats_mode = False
    if "--graph-stats" in args:
        graph_stats_mode = True
        args = [a for a in args if a != "--graph-stats"]

    docs_dir = None
    if "--docs-dir" in args:
        idx = args.index("--docs-dir")
        if idx + 1 >= len(args):
            print("ERROR: --docs-dir requires a directory argument", file=sys.stderr)
            sys.exit(1)
        docs_dir = args[idx + 1]
        del args[idx:idx + 2]

    # 충족 임계는 상태머신이 정한다. --docs-dir 미지정 시 현행([xx] 단독) 유지.
    if docs_dir is None:
        satisfied = {"[xx]"}
    else:
        sm, _path, sm_err = _wbs_status.resolve_state_machine(docs_dir)
        if sm_err:
            print(f"ERROR: {sm_err}", file=sys.stderr)
            sys.exit(1)
        satisfied = _wbs_status.satisfied_states(sm)
```

- [ ] 완료 판정(386-391행)을 교체한다:

```python
        category = item.get("category", "")
        if (any(s in status for s in satisfied)
                or item.get("bypassed") or category == "feat"):
            completed.append(tsk_id)
            is_completed.add(tsk_id)
            continue
```

- [ ] 결과 dict(453-459)에 임계를 노출한다:

```python
    result = {
        "levels": levels,
        "completed": completed,
        "circular": circular,
        "total": len(tasks) + len(completed),
        "pending": len(tasks),
        "satisfied_states": sorted(satisfied),
    }
```

- [ ] USAGE(20-30행)에 플래그와 의미를 적는다:

```
Usage: dep-analysis.py [input-file] [--graph-stats] [--docs-dir DIR]

  --docs-dir DIR  상태머신을 해석해 의존 충족 임계를 정한다.
                  6상태 정의면 [im] 이상, 5상태 정의(또는 미지정)면 [xx] 만 충족.
```

- [ ] 통과를 확인한다: `python3 -m pytest scripts/test_dep_analysis_threshold.py -q` → 기대: `5 passed`
- [ ] 회귀 확인: `python3 -m pytest scripts/test_dep_analysis_critical_path.py scripts/test_dep_analysis_graph_stats.py -q`
- [ ] 전체 테스트 스위트를 돌린다: `python3 -m pytest scripts/test_*.py -q`
- [ ] 커밋: `git add scripts/dep-analysis.py scripts/test_dep_analysis_threshold.py && git commit -m "fix(dep): 의존 충족 임계를 상태머신에서 읽는다 — 문서는 [im] 이상인데 코드는 [xx] 만 봤다"`

> **호출자 미배선**: `skills/dev-team/SKILL.md:254` · `skills/dev-seq/SKILL.md:122` ·
> `skills/agent-pool/SKILL.md:85` 의 파이프라인은 모두 `--docs-dir` 없이 호출한다.
> 결정 A 이후 이 경로들은 D'Flow API 소비로 대체될 예정이라 배선하지 않는다.

---

## 부록 A: 스코프 아웃 — 로컬 6상태 상태머신 (구 DEV-01)

**결정**: 로컬 `wbs.md`/`state.json` 에서 6상태를 실행하지 않는다. 아래 5건은 설계·실측까지 끝났으나
**연동 경로에서 제외**한다. 삭제가 아니라 보류이므로 되살릴 때 쓸 근거와 설계 요지를 남긴다.

### A-0. 왜 스코프 아웃인가

결정 A(WBS 중앙관리)로 상태 축이 둘로 갈렸다:

| 축 | 정본 | 어휘 | 누가 쓰나 |
|---|---|---|---|
| **D'Flow `stage`** | DB | 6상태 `todo/as/fp/ip/im/xx` | 사람 게이트(assign·force·accept), 진척 파생, 배정·발행 |
| **로컬 사이클** | `docs/tasks/{TSK}/state.json` | 5상태 `[ ]/[dd]/[im]/[ts]/[xx]` | `/dev` 한 번의 실행 안에서 설계→구현→테스트→리팩토링 재개 위치 판정 |

사람 게이트 이벤트(`assign`/`unassign`/`force`/`unforce`/`accept`)는 **웹 세션에서 발생**하고 D'Flow 가
기록한다. 로컬 `wbs-transition.py` 가 같은 이벤트를 중복 구현하면 정본이 둘이 되어 결정 A 가 없애려던
다인·다PC 충돌을 그대로 되살린다. `cycle.start` 도 마찬가지로 claim(API) 이 그 역할을 한다.

`[ip]`(20%)/`[im]`(60%) 진척 환산도 D'Flow 가 `stage` 에서 파생하므로(`plannedPct`/`statusOf` 재사용,
산식 정본은 D'Flow) 로컬 `--progress` 모드가 필요 없다.

**두 축의 유일한 접점은 `stage` 번역표**이고, 그것만 Task 1 `_wbs_status.STAGE_CODE` 로 남았다.

### A-1. wbs-transition — 상태머신 해석 체인 + 레거시 정규화 [스코프 아웃]

`wbs-transition.py:353` 의 하드코딩 `known_states = {"[ ]", "[dd]", "[im]", "[ts]", "[xx]"}` 를
`_wbs_status.known_states(sm)` 로 바꾸고, `load_state_machine(docs_dir)` 이 프로젝트
`state-machine.json` 을 우선 해석하게 하는 설계였다. 레거시 정규화는
`[dd]`→`[ip]` · `[ts]`→`[ip]` · `[dd!]`→`[ ]` · `[im!]`→`[ip]`, `[im]` 은 코드 유지
(`dev-workflow/docs/wbs-workflow.md:295` 결정).

**되살릴 조건**: 로컬에서 6상태를 직접 전이시켜야 할 이유가 생겼을 때. 그 전까지
`wbs-transition.py` 는 **한 글자도 바꾸지 않는다** — 기존 5상태 사용자 회귀 방지의 가장 확실한 형태다.

### A-2. wbs-transition — 사람 게이트 `--actor` [스코프 아웃]

`--actor human|agent`(기본 `agent`)를 받아 `assign`/`unassign`/`force`/`unforce`/`accept` 를
에이전트가 발행하면 `{"error": "human_gate", "ok": false}` exit 1 로 막는 설계였다.
**D'Flow 서버가 같은 게이트를 403 `human_gate` 로 이미 갖는다**(부록 §2.5-② 전이 권한표).
클라이언트측 중복 게이트는 방어선이 아니라 갈라짐이다.

### A-3. wbs-transition — `cycle.start` 메타 이벤트 [스코프 아웃]

`cycle.start` 를 `bypass` 와 동급의 항상-알려진 메타 이벤트로 만들어 5상태 정의에서 무해한 no-op 이
되게 하고, 6상태 정의에서 `[ ]` 이면 `not_assigned` 로 거부하는 설계였다.
착수 시점 기록은 **claim(API)** 이 담당한다.

**남는 사실**: `skills/dev-design`·`dev-build`·`dev-seq`·`dev-team`·`feat` 중 어느 것도 `cycle.start` 를
발행하지 않는다(실측). 6상태를 로컬에서 되살리려면 이 배선이 선행 조건이다.

### A-4. merge 드라이버 2종 — 6상태 어휘 자동 감지 [스코프 아웃]

`merge-wbs-status.py`/`merge-state-json.py` 의 `STATUS_PRIORITY` 를 파일 내용에서 감지한
어휘별 표(5상태 / 6상태)로 나누고 `STATUS_LINE_RE` 를 union 으로 넓히는 설계였다.

**실측으로 확인된 제약(되살릴 때 반드시 지킬 것)**: 두 어휘는 순서가 상충한다 —
5상태는 `[ts] > [im]`, 6상태는 `[im] > [ip]`. **단일 통합표로는 두 순서를 동시에 만족할 수 없고**,
`test_merge_state_json.py::test_merge_state_json_status_priority_matrix`(5×5 전수)가 이를 강제한다.
해법은 어휘 감지뿐이다. "표를 하나로 단순화" 하려는 시도는 그 테스트에서 반드시 깨진다.

로컬 `wbs.md`/`state.json` 이 5상태를 유지하는 한 이 확장은 불필요하다.

### A-5. wbs-parse — `--progress` 모드 [스코프 아웃]

`state-machine.json` 의 `progress.agile.state_weights`(0/0/0/20/60/100)를 읽어 Task 별 진척%를
내는 모드였다(환산표 하드코딩 금지 원칙 준수). **진척 파생의 정본은 D'Flow** 이며
(dev-workflow 문서가 `plannedPct`/`statusOf` 재사용을 명시), 로컬에서 같은 값을 두 번 계산하면
어긋날 때 어느 쪽이 맞는지 판정할 근거가 없다.

`--phase-start`(990행)와 feat 모드(744행)도 **플러그인 5상태 정의를 계속 읽는다** — 6상태 정의를
읽히면 `[ip]` → `"resume-by-artifact"`, `[ ]` → `null` 을 답하는데 이를 해석할 스킬이 없다.

---

## 이 계획이 남기는 미결 (후속 별도 계획)

1. **`/dev` 계열의 API 소비 전환.** 결정 A 의 본체다 — `dflow.sh` claim 시 명세를
   `docs/tasks/{TSK}/spec.md` 로 캐시하고 `/dev` 가 `wbs.md` 대신 그 캐시를 읽게 하는 작업.
   이 계획은 **부트스트랩(파일→DB) 한 방향만** 만든다.
2. **변환기와 `POST /api/v1/wbs/import`.** export JSON v2 를 받아 `external_ref` upsert 하는 쪽은
   wbs-web 로드맵(TSK-07-04)이다. 이 계획은 그 입력을 생산할 뿐이다.
3. **계약 v3 후보 필드.** `tech-spec`(bookloop 5) · `ui-spec`(6) · `note`(2) · `blocked-by`(1) 는
   v2 확정 목록에 없어 export 에서 빠진다. D'Flow 쪽 소비처가 생기면 v3 안건.
4. **`wbs.md` 은퇴 절차.** 부트스트랩 이후 로컬 `wbs.md` 를 읽기 전용으로 못박거나 제거하는 규약이
   아직 없다. 남아 있는 동안은 파일과 DB 가 갈라질 수 있다(부록 계약 §7.2-3 필드 소유권 표).
5. **`--reason` 플래그 부재.** `skills/dev-team/references/merge-procedure.md` 가
   `wbs-transition.py {WBS} {TSK} bypass --reason ...` 로 호출하지만 `parse_args` 는 `--reason` 을
   모르고 위치 인자로 흡수한다(reason 값이 `--reason` 이 된다). 기존 결함이며 이 계획의 범위 밖.
6. **DEV-04 프로그램 리스트 입력 어댑터** (`wbs-wsf` 스킬) — 처음부터 범위 밖. 별도 계획.
