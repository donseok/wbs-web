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
        self.assertIsNone(t["stage"])
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
            self.assertEqual(out["schema_version"], "2.1")
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
            self.assertEqual(stages, {None, "im", "ip"})
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


if __name__ == "__main__":
    unittest.main()
