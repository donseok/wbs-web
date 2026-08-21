#!/usr/bin/env python3
"""wbs-nlevel-parse.py — N단 wbs.md 검증·export 테스트 (계약 v2.2).

계약 정본: docs/superpowers/specs/2026-08-21-wbs-nlevel-md-contract.md §import 계약 v2.2
"""
from __future__ import annotations

import importlib.util
import pathlib
import unittest

_THIS_DIR = pathlib.Path(__file__).resolve().parent
_MODULE_PATH = _THIS_DIR / "wbs-nlevel-parse.py"
_spec = importlib.util.spec_from_file_location("wbs_nlevel_parse", _MODULE_PATH)
assert _spec and _spec.loader
m = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(m)

PL_MD = """---
project: MES
module: mes-op
attach: PH-03/SYS-OP

levels:
  - { name: Phase,     prefix: PH,  progress: rollup, owner: pmo, upload: false }
  - { name: System,    prefix: SYS, progress: rollup, owner: pmo, upload: false }
  - { name: Subsystem, prefix: SUB, progress: rollup }
  - { name: WP,        prefix: WP,  progress: rollup, report: weekly }
  - { name: Activity,  prefix: ACT, progress: rollup, optional: true }
  - { name: Task,      prefix: TSK, progress: input }
  - { name: SubTask,   prefix: STK, progress: checklist, optional: true, upload: fold }

credits:
  default: { 대기: 0, 설계: 20, 구현중: 50, 구현완료: 70, 테스트완료: 90, 검수완료: 100 }
  if:      { 대기: 0, 구현중: 30, 구현완료: 50, 연동검증: 100 }
---

# WBS — MES 조업

## SUB-OP-IN: 입측

### WP-OP-IN-PR: 프로세스
- [ ] TSK-OP-IN-PR-01: 입측 실적 수집 프로세스   @홍길동  w:5  ~2026-11-14
  - category: dev
  - domain: backend
  - priority: critical
  - tags: op, entry
  - depends: TSK-OP-IN-PR-02
  - prd-ref: OP-PRD §4.2
  - requirements: L2 인입 통보 시 실적 생성.
  - acceptance: 단일 트랜잭션 / 중복 수신 멱등
  - [ ] STK-OP-IN-PR-01-1: 크레인 계량 연계 확인
  - [x] STK-OP-IN-PR-01-2: 중복 수신 방어 로직
- [ ] TSK-OP-IN-PR-02: 입측 판정 프로세스   w:3  ~2026-11-21  credit:if  if-id:IF-0031
- [M] TSK-OP-IN-PR-90: 입측 오픈 점검   ~2026-11-30
"""


def _parse(md: str):
    return m.parse_wbs(md)


class Validate(unittest.TestCase):
    def test_pl_file_ok(self):
        r = m.validate(_parse(PL_MD), role="pl")
        self.assertEqual(r["errors"], [])

    def test_unknown_prefix_error(self):
        bad = PL_MD.replace("## SUB-OP-IN: 입측", "## ZZZ-1: 미선언")
        r = m.validate(_parse(bad), role="pl")
        self.assertTrue(any("접두어" in e for e in r["errors"]))

    def test_child_level_must_descend(self):
        bad = PL_MD.replace("### WP-OP-IN-PR: 프로세스", "### SUB-OP-XX: 역행")
        r = m.validate(_parse(bad), role="pl")
        self.assertTrue(any("순번" in e for e in r["errors"]))

    def test_pl_body_must_not_contain_pmo_layers(self):
        bad = PL_MD.replace("## SUB-OP-IN: 입측", "## PH-03: 구축\n\n## SUB-OP-IN: 입측")
        r = m.validate(_parse(bad), role="pl")
        self.assertTrue(any("골격" in e for e in r["errors"]))

    def test_duplicate_id_error(self):
        bad = PL_MD.replace(
            "- [ ] TSK-OP-IN-PR-02: 입측 판정 프로세스   w:3  ~2026-11-21  credit:if  if-id:IF-0031",
            "- [ ] TSK-OP-IN-PR-01: 중복 ID   w:3  ~2026-11-21",
        )
        r = m.validate(_parse(bad), role="pl")
        self.assertTrue(any("중복" in e for e in r["errors"]))

    def test_checked_state_only_on_checklist_layer(self):
        bad = PL_MD.replace("- [ ] TSK-OP-IN-PR-02:", "- [x] TSK-OP-IN-PR-02:")
        r = m.validate(_parse(bad), role="pl")
        self.assertTrue(any("[ ]" in e for e in r["errors"]))

    def test_percent_in_title_error(self):
        bad = PL_MD.replace("입측 판정 프로세스", "입측 판정 프로세스 30%")
        r = m.validate(_parse(bad), role="pl")
        self.assertTrue(any("%" in e for e in r["errors"]))

    def test_milestone_requires_id(self):
        bad = PL_MD.replace("- [M] TSK-OP-IN-PR-90: 입측 오픈 점검   ~2026-11-30",
                            "- [M] 입측 오픈 점검   ~2026-11-30")
        r = m.validate(_parse(bad), role="pl")
        self.assertTrue(any("마일스톤" in e for e in r["errors"]))

    def test_rollup_leaf_is_warning_not_error(self):
        bad = PL_MD.replace("""### WP-OP-IN-PR: 프로세스
- [ ] TSK-OP-IN-PR-01""", """### WP-OP-IN-EMPTY: 빈 WP

### WP-OP-IN-PR: 프로세스
- [ ] TSK-OP-IN-PR-01""")
        r = m.validate(_parse(bad), role="pl")
        self.assertEqual(r["errors"], [])
        self.assertTrue(any("leaf" in w or "리프" in w for w in r["warnings"]))

    def test_depends_missing_target_warning(self):
        bad = PL_MD.replace("depends: TSK-OP-IN-PR-02", "depends: TSK-OP-NOPE-99")
        r = m.validate(_parse(bad), role="pl")
        self.assertTrue(any("depends" in w for w in r["warnings"]))

    def test_pl_role_requires_attach_and_module(self):
        bad = PL_MD.replace("attach: PH-03/SYS-OP\n", "")
        r = m.validate(_parse(bad), role="pl")
        self.assertTrue(any("attach" in e for e in r["errors"]))


class Export(unittest.TestCase):
    def setUp(self):
        self.payload = m.export_payload(_parse(PL_MD), attach_ref="mes-skel/SYS-OP")
        self.nodes = {n["id"]: n for n in self.payload["nodes"]}

    def test_envelope(self):
        self.assertEqual(self.payload["schema_version"], "2.2")
        self.assertEqual(self.payload["module"], "mes-op")
        self.assertEqual(self.payload["attach_ref"], "mes-skel/SYS-OP")
        self.assertEqual([l["name"] for l in self.payload["levels"]][0], "Phase")

    def test_top_node_has_no_parent(self):
        self.assertIsNone(self.nodes["SUB-OP-IN"]["parent_id"])

    def test_levels_and_flags(self):
        self.assertEqual(self.nodes["SUB-OP-IN"]["level"], 2)
        self.assertEqual(self.nodes["WP-OP-IN-PR"]["level"], 3)
        t = self.nodes["TSK-OP-IN-PR-01"]
        self.assertEqual(t["level"], 5)
        self.assertEqual(t["parent_id"], "WP-OP-IN-PR")
        self.assertEqual(t["weight"], 5)
        self.assertEqual(t["assignee"], "홍길동")
        self.assertEqual(t["schedule"], "~ 2026-11-14")
        self.assertEqual(t["depends"], ["TSK-OP-IN-PR-02"])
        self.assertEqual(t["category"], "dev")
        self.assertEqual(t["priority"], "critical")
        self.assertEqual(t["tags"], ["op", "entry"])
        self.assertEqual(t["prd_ref"], "OP-PRD §4.2")

    def test_stk_folds_into_parent_acceptance(self):
        t = self.nodes["TSK-OP-IN-PR-01"]
        self.assertNotIn("STK-OP-IN-PR-01-1", self.nodes)  # fold — 노드로 안 나감
        self.assertIn("[ ] 크레인 계량 연계 확인", t["acceptance"])
        self.assertIn("[x] 중복 수신 방어 로직", t["acceptance"])
        # 상세 블록 acceptance 도 유지(/ 분리)
        self.assertIn("단일 트랜잭션", t["acceptance"])

    def test_credit_and_if_id(self):
        t2 = self.nodes["TSK-OP-IN-PR-02"]
        self.assertEqual(t2["credit"], "if")
        self.assertEqual(t2["if_id"], "IF-0031")

    def test_milestone_flag(self):
        ms = self.nodes["TSK-OP-IN-PR-90"]
        self.assertTrue(ms["milestone"])
        self.assertEqual(ms["schedule"], "~ 2026-11-30")

    def test_deterministic(self):
        again = m.export_payload(_parse(PL_MD), attach_ref="mes-skel/SYS-OP")
        self.assertEqual(self.payload, again)


if __name__ == "__main__":
    unittest.main()
