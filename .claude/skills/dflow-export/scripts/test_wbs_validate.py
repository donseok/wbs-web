#!/usr/bin/env python3
"""Unit tests for wbs-validate.py"""
from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

_THIS_DIR = Path(__file__).resolve().parent
_MODULE_PATH = _THIS_DIR / "wbs-validate.py"

_spec = importlib.util.spec_from_file_location("wbs_validate", _MODULE_PATH)
wbs_validate = importlib.util.module_from_spec(_spec)
sys.modules["wbs_validate"] = wbs_validate
_spec.loader.exec_module(wbs_validate)


CLEAN_WBS = """\
# WBS

## Dev Config
...

## WP-01: 인증

### TSK-01-01: 로그인 API
- domain: backend
- depends: -
- status: [ ]
- acceptance: 로그인 응답 200ms 이하 + 401 실패 시 에러 메시지 노출

본 Task는 백엔드 인증 엔드포인트 작성을 다룬다.

### TSK-01-02: 로그인 화면
- domain: frontend
- depends: TSK-01-01
- status: [ ]
- acceptance: e2e 테스트 통과 + 30초 안에 로그인 완료

## WP-02: 결제
- phase: PH-2
"""

PROBLEMATIC_WBS = """\
# WBS

## WP-01: foo

### TSK-01-01: 로그인 API
- domain: backend
- depends: TSK-99-99
- status: [ ]

설명만 있고 acceptance 없음. API 구현 진행.

### TSK-01-02: 검색 페이지
- domain: unknown_domain
- depends: -
- status: [ ]
- acceptance: 검색이 빠르게 동작
"""


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


FENCED_WBS = """\
# WBS

## WP-01: 배포

### TSK-01-01: 배포 스크립트
- domain: backend
- depends: -
- status: [ ]

Task 본문에 예시 셸 스크립트가 들어간다.

```bash
# 배포 스크립트 예시 — 헤딩이 아니라 코드 주석이다
echo "deploy"
```

- acceptance: 헬스체크 200ms 이하 통과

### TSK-01-02: 다음 Task
- domain: backend
- depends: -
- status: [ ]
- acceptance: 검증 완료
"""

FENCED_PHANTOM_TASK_WBS = """\
# WBS

## WP-01: 문서화

### TSK-01-01: 예시 문서 작성
- domain: docs
- depends: -
- status: [ ]
- acceptance: 예시 문서 리뷰 통과

예시로 다른 Task 헤딩 형식을 코드 블록에 보여준다.

```markdown
#### TSK-99-99-99: 이것은 예시일 뿐 실제 Task 가 아니다
```

### TSK-01-02: 다음 Task
- domain: docs
- depends: -
- status: [ ]
- acceptance: 검증 완료
"""

FENCED_INDENTED_WBS = """\
# WBS

## WP-01: 배포

### TSK-01-01: 배포 스크립트
- domain: backend
- depends: -
- status: [ ]

리스트 항목 아래 들여쓴 펜스 코드 예시:

- 참고:
  ```bash
  # 들여쓴 펜스 안의 주석 — 헤딩이 아니다
  echo "deploy"
  ```

- acceptance: 헬스체크 200ms 이하 통과

### TSK-01-02: 다음 Task
- domain: backend
- depends: -
- status: [ ]
- acceptance: 검증 완료
"""

UNCLOSED_FENCE_WBS = """\
# WBS

## WP-01: 배포

### TSK-01-01: 배포 스크립트
- domain: backend
- depends: -
- status: [ ]
- acceptance: 헬스체크 200ms 이하 통과

예시 스크립트(펜스를 실수로 닫지 않음):

```bash
# 배포 스크립트 예시 — 닫는 펜스가 없다

### TSK-01-02: 다음 Task
- domain: backend
- depends: -
- status: [ ]
- acceptance: 검증 완료
"""

MISPAIRED_FENCE_WBS = """\
# WBS

## WP-01: x

### TSK-01-01: A
- domain: backend
- depends: -
- status: [ ]
- acceptance: 응답 200ms 이하

```bash
# 닫는 펜스를 빠뜨림

### TSK-01-02: B
- domain: backend
- depends: -
- status: [ ]
- acceptance: 응답 200ms 이하

### TSK-01-03: C
- domain: backend
- depends: -
- status: [ ]
- acceptance: 응답 200ms 이하

```bash
echo ok
```
"""


class TestSplitTasks(unittest.TestCase):
    def test_split_clean_wbs(self):
        blocks = wbs_validate._split_tasks(CLEAN_WBS)
        ids = [b["id"] for b in blocks]
        self.assertEqual(ids, ["TSK-01-01", "TSK-01-02"])

    def test_split_empty(self):
        blocks = wbs_validate._split_tasks("# Empty WBS\n\n## WP-01\n")
        self.assertEqual(blocks, [])


class TestParseMeta(unittest.TestCase):
    def test_basic_meta(self):
        block = "### TSK-01-01: x\n- domain: backend\n- depends: TSK-00\n"
        meta = wbs_validate._parse_meta(block)
        self.assertEqual(meta["domain"], "backend")
        self.assertEqual(meta["depends"], "TSK-00")

    def test_depends_list_split(self):
        meta = {"depends": "TSK-01, TSK-02 TSK-03"}
        deps = wbs_validate._depends_list(meta)
        self.assertEqual(set(deps), {"TSK-01", "TSK-02", "TSK-03"})

    def test_depends_none(self):
        for raw in ("-", "none", "n/a", ""):
            meta = {"depends": raw}
            self.assertEqual(wbs_validate._depends_list(meta), [])


class TestAcceptance(unittest.TestCase):
    def test_acceptance_in_meta(self):
        block = "### TSK-01-01\n- acceptance: 응답 200ms\n"
        meta = wbs_validate._parse_meta(block)
        self.assertTrue(wbs_validate._has_acceptance(block, meta))

    def test_acceptance_in_subsection(self):
        block = "### TSK-01-01\n\n#### Acceptance Criteria\n- response < 200ms\n"
        meta = wbs_validate._parse_meta(block)
        self.assertTrue(wbs_validate._has_acceptance(block, meta))

    def test_no_acceptance(self):
        block = "### TSK-01-01\n- domain: backend\n\n본문만 있음.\n"
        meta = wbs_validate._parse_meta(block)
        self.assertFalse(wbs_validate._has_acceptance(block, meta))


class TestDomainMapping(unittest.TestCase):
    def test_default_domain_passes(self):
        ok, _ = wbs_validate._check_domain_mapping("default", None)
        self.assertTrue(ok)
        ok, _ = wbs_validate._check_domain_mapping("-", None)
        self.assertTrue(ok)

    def test_no_dev_config_passes(self):
        ok, _ = wbs_validate._check_domain_mapping("frontend", None)
        self.assertTrue(ok)

    def test_unknown_domain_fails(self):
        dc = {"domains": {"backend": {}, "frontend": {}}}
        ok, _ = wbs_validate._check_domain_mapping("unknown", dc)
        self.assertFalse(ok)

    def test_known_domain_passes(self):
        dc = {"domains": {"backend": {}, "frontend": {}}}
        ok, _ = wbs_validate._check_domain_mapping("frontend", dc)
        self.assertTrue(ok)


class TestValidateWBS(unittest.TestCase):
    def test_clean_wbs_passes(self):
        result = wbs_validate.validate_wbs(CLEAN_WBS)
        self.assertTrue(result["ok"], result)
        self.assertEqual(result["summary"]["task_count"], 2)

    def test_problematic_wbs_detects_all_issues(self):
        dc = {"domains": {"backend": {}, "frontend": {}}}
        result = wbs_validate.validate_wbs(PROBLEMATIC_WBS, dev_config=dc)
        self.assertFalse(result["ok"])
        types = {i["type"] for i in result["issues"]}
        self.assertIn("missing_acceptance", types)
        self.assertIn("depends_unknown", types)
        self.assertIn("test_unmapped", types)


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


class TestFencedCodeInBlock(unittest.TestCase):
    """리뷰 지적: 펜스 코드 내부의 `#` 로 시작하는 줄(주석 등)이 헤딩으로 오인되어
    블록을 조기 절단하면 안 된다."""

    def test_heading_like_line_inside_fence_does_not_close_block(self):
        blocks = {b["id"]: b["block"] for b in wbs_validate._split_tasks(FENCED_WBS)}
        first = blocks["TSK-01-01"]
        self.assertIn("echo \"deploy\"", first)               # 펜스 내부도 포함
        self.assertIn("acceptance: 헬스체크", first)          # 펜스 뒤 내용도 포함
        self.assertNotIn("TSK-01-02", first)                  # 다음 Task 는 제외

    def test_fenced_wbs_reports_no_missing_acceptance(self):
        result = wbs_validate.validate_wbs(FENCED_WBS)
        types = {i["type"] for i in result["issues"]}
        self.assertNotIn("missing_acceptance", types)

    def test_task_heading_text_inside_fence_is_detected_as_visible_task(self):
        """의도된 트레이드오프(advisor round-3 재검토 반영): Task 탐지에는 펜스
        필터를 적용하지 않는다. 펜스 안 예시 텍스트가 우연히 Task 헤딩 형식이면
        phantom Task 로 잡히지만(눈에 보이는 과다 탐지), 펜스 페어링이 틀렸을 때
        실제 Task 가 조용히 사라지는(과소 탐지) 쪽보다 훨씬 안전하다."""
        blocks = wbs_validate._split_tasks(FENCED_PHANTOM_TASK_WBS)
        ids = [b["id"] for b in blocks]
        self.assertEqual(ids, ["TSK-01-01", "TSK-99-99-99", "TSK-01-02"])

    def test_indented_fence_does_not_close_block(self):
        blocks = {b["id"]: b["block"] for b in wbs_validate._split_tasks(FENCED_INDENTED_WBS)}
        first = blocks["TSK-01-01"]
        self.assertIn("echo \"deploy\"", first)
        self.assertIn("acceptance: 헬스체크", first)
        self.assertNotIn("TSK-01-02", first)

    def test_unclosed_fence_does_not_swallow_later_task(self):
        """재리뷰 지적: 미폐쇄 펜스 뒤 실제 Task 헤딩이 증발(silent undercount)하면 안
        된다 — 의심스러우면 Task 를 잃지 않는 쪽을 택한다."""
        blocks = wbs_validate._split_tasks(UNCLOSED_FENCE_WBS)
        ids = [b["id"] for b in blocks]
        self.assertEqual(ids, ["TSK-01-01", "TSK-01-02"])

    def test_unclosed_fence_task_count_matches_real_headings(self):
        result = wbs_validate.validate_wbs(UNCLOSED_FENCE_WBS)
        self.assertEqual(result["summary"]["task_count"], 2)

    def test_mispaired_fence_does_not_swallow_tasks_between_markers(self):
        """advisor 재검토 지적: 닫는 펜스를 하나 빠뜨렸을 때, 그 뒤에 완결된 펜스
        쌍이 하나 더 있으면 위치 기반 페어링이 엉뚱하게 짝지어져 그 사이의 Task
        들이 통째로 사라질 수 있다. matches 는 펜스 필터를 타지 않으므로 셋 다
        탐지돼야 한다."""
        blocks = {b["id"]: b["block"] for b in wbs_validate._split_tasks(MISPAIRED_FENCE_WBS)}
        ids = list(blocks)
        self.assertEqual(ids, ["TSK-01-01", "TSK-01-02", "TSK-01-03"])
        # Task 헤딩은 펜스 상태와 무관하게 항상 경계 후보다 — TSK-01-01 이
        # 미스페어링된 펜스를 넘어 TSK-01-02 의 내용을 흡수하면 안 된다.
        self.assertNotIn("TSK-01-02", blocks["TSK-01-01"])

    def test_mispaired_fence_does_not_mask_missing_acceptance(self):
        """advisor 재검토 지적: 블록 경계가 미스페어링된 펜스를 넘어가면 뒤 Task
        의 acceptance 메타가 앞 Task 를 덮어써 missing_acceptance 가 가려지고
        ok:true 가 나올 수 있다."""
        no_acceptance = MISPAIRED_FENCE_WBS.replace(
            "- acceptance: 응답 200ms 이하\n\n```bash\n# 닫는 펜스를 빠뜨림",
            "\n```bash\n# 닫는 펜스를 빠뜨림",
        )
        result = wbs_validate.validate_wbs(no_acceptance)
        missing = [i for i in result["issues"] if i["type"] == "missing_acceptance"]
        self.assertEqual([i["task"] for i in missing], ["TSK-01-01"])


class TestCLI(unittest.TestCase):
    def _run(self, args: list[str]) -> subprocess.CompletedProcess:
        return subprocess.run(
            [sys.executable, str(_MODULE_PATH), *args],
            capture_output=True, text=True,
        )

    def test_cli_validate_clean(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "wbs.md"
            p.write_text(CLEAN_WBS, encoding="utf-8")
            r = self._run(["validate", "--wbs", str(p)])
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertTrue(json.loads(r.stdout)["ok"])

    def test_cli_validate_problematic(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "wbs.md"
            p.write_text(PROBLEMATIC_WBS, encoding="utf-8")
            dc = json.dumps({"domains": {"backend": {}, "frontend": {}}})
            r = self._run(["validate", "--wbs", str(p), "--dev-config-json", dc])
            self.assertEqual(r.returncode, 1)
            payload = json.loads(r.stdout)
            self.assertFalse(payload["ok"])
            self.assertGreater(payload["summary"]["total"], 0)

    def test_cli_missing_wbs(self):
        r = self._run(["validate", "--wbs", "/nonexistent/wbs.md"])
        self.assertEqual(r.returncode, 2)

    def test_cli_invalid_dev_config_json(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "wbs.md"
            p.write_text(CLEAN_WBS, encoding="utf-8")
            r = self._run(["validate", "--wbs", str(p), "--dev-config-json", "{not valid"])
            self.assertEqual(r.returncode, 2)


if __name__ == "__main__":
    unittest.main()
