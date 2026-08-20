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
        self.assertIsNone(_wbs_status.stage_code("[ ]"))
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
    """resolve_state_machine()이 읽는 WBS_STATE_MACHINE/CLAUDE_PLUGIN_ROOT는
    테스트 하네스가 실행되는 환경에 이미 설정돼 있을 수 있다. 매 테스트 전에
    두 값을 제거하고, 종료 시 원래 환경 전체를 복원해 격리한다."""

    def setUp(self):
        self._env_snapshot = dict(os.environ)
        os.environ.pop("WBS_STATE_MACHINE", None)
        os.environ.pop("CLAUDE_PLUGIN_ROOT", None)

    def tearDown(self):
        os.environ.clear()
        os.environ.update(self._env_snapshot)

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
            sm, path, err = _wbs_status.resolve_state_machine(None)
            self.assertIsNone(err)
            self.assertEqual(path, str(p))
            # tearDown이 환경 전체를 복원하므로 여기서 del 불필요


if __name__ == "__main__":
    unittest.main()
