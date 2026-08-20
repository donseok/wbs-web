#!/usr/bin/env python3
"""wbs-validate.py — WBS Task 품질 검사

상류 품질 게이트의 두 번째 단계. /wbs가 PRD/TRD에서 WBS를 생성한 뒤,
각 Task가 acceptance criteria / depends 완결성 / 도메인 매핑 / 정량 기준을
갖췄는지 검사한다. 미흡 Task만 LLM이 재작성하도록 안내하는 정보 제공자다.

검출 항목 per Task:
  1. acceptance      acceptance criteria 또는 'success criteria' 비고 누락
  2. depends_unknown depends에 명시된 TSK-ID가 wbs.md에 존재하지 않음
  3. test_unmapped   domain이 Dev Config에 매핑되지 않음 (e2e/unit 명령 부재)
  4. vague_action    "구현/배포/검증" 같은 동사가 정량 기준 없이 사용됨

서브커맨드:
  validate --wbs FILE [--dev-config-json STR]
                                  WBS 정합성 검사 → JSON

사용:
  wbs-validate.py validate --wbs docs/wbs.md
  wbs-validate.py validate --wbs docs/wbs.md \\
    --dev-config-json '{"domains": {"backend": {...}}}'

종료 코드:
  0  ok=true (issue 없음)
  1  ok=false (issue 1개 이상)
  2  사용 오류

Python stdlib only.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _wbs_md import FENCE_RE, _fenced_ranges, _in_ranges  # noqa: E402

# Task 헤딩: 3단계 `### TSK-XX-YY:` / 4단계 `#### TSK-XX-YY-ZZ:` 겸용.
# 세그먼트 수를 고정하지 않는다 — ACT 계층이 들어가면 세그먼트가 하나 는다.
TASK_HEADING_RE = re.compile(
    r"^(?P<level>#{3,5})\s+(?P<id>TSK-\d+(?:-\d+)+):\s*(?P<title>.*)$", re.MULTILINE)

# 블록 경계 계산용 — 모든 헤딩의 위치와 레벨
HEADING_RE = re.compile(r"^(#{1,6})\s", re.MULTILINE)

META_LINE_RE = re.compile(r"^-\s*(?P<key>[a-zA-Z][a-zA-Z0-9_-]*)\s*:\s*(?P<val>.*?)\s*$", re.MULTILINE)

ACCEPTANCE_HINT_RE = re.compile(
    r"(?im)^\s*(?:#{2,}\s+|\*\*)?(acceptance(?:\s*criteria)?|수락\s*기준|완료\s*조건|성공\s*기준)\b"
)

QUANT_HINT_RE = re.compile(
    r"\b\d+\s*(ms|s|sec|seconds?|minutes?|hours?|%|p\d+|MB|GB|TB|KB|bytes?|"
    r"req(/s)?|qps|tps|rps|users?|MAU|DAU|건|회|개|초|분|시간)\b",
    re.IGNORECASE,
)

VAGUE_VERBS = ["구현", "배포", "검증", "정리", "개선", "최적화", "implement", "deploy", "verify"]


def _split_tasks(content: str) -> list[dict]:
    """wbs.md를 Task 블록 리스트로 분리.

    블록은 '레벨이 자기 이하인 다음 헤딩' 에서 끝난다. 4단계 WBS 에서 Task 는
    `####`, 하위 절은 `#####` 이므로 하위 절은 블록 안에 남고 `### ACT-`·`## WP-`
    는 블록을 닫는다. 펜스 코드 블록(```` ``` ````) 내부의 `# ...` 줄은 코드 주석일
    뿐 헤딩이 아니므로 경계 계산(`headings`)에서는 제외한다.

    Task 탐지(`matches`)에는 펜스 필터를 적용하지 않는다 — 펜스 페어링은 마커를
    위치 순으로 단순히 짝짓기 때문에, 닫는 펜스를 빠뜨린 문서에서 그 뒤에 완결된
    펜스 쌍이 하나라도 더 있으면 엉뚱하게 짝지어져 그 사이의 실제 Task 헤딩이
    통째로 사라질 수 있다(silent undercount). 펜스 안 예시 텍스트가 우연히
    `#### TSK-...:` 형태여서 phantom Task 로 잡히는 쪽(눈에 보이는 과다 탐지)이,
    실제 Task 가 조용히 사라지는 쪽(과소 탐지 + ok:true)보다 훨씬 안전하다 —
    Task 4 가 애초에 고치려던 결함군이 바로 후자다.

    같은 이유로 Task 헤딩은 펜스 상태와 무관하게 항상 경계(`headings`) 후보에도
    포함한다 — 그러지 않으면 미스페어링된 펜스 안의 '탐지는 됐지만 경계 후보에서는
    빠진' Task 헤딩이 앞 Task 의 블록을 닫지 못해, 앞 Task 가 뒤 Task 의 메타를
    덮어써 missing_acceptance 같은 결함이 가려지고 ok:true 가 나올 수 있다.
    """
    fences = _fenced_ranges(content)
    matches = list(TASK_HEADING_RE.finditer(content))
    task_positions = {m.start() for m in matches}
    headings = [
        (m.start(), len(m.group(1)))
        for m in HEADING_RE.finditer(content)
        if m.start() in task_positions or not _in_ranges(m.start(), fences)
    ]
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


def _parse_meta(block: str) -> dict:
    """Task 블록에서 metadata 라인(- key: val)을 파싱."""
    meta: dict[str, str] = {}
    for fm in META_LINE_RE.finditer(block):
        key = fm.group("key").strip().lower()
        val = fm.group("val").strip()
        meta[key] = val
    return meta


def _has_acceptance(block: str, meta: dict) -> bool:
    """Task가 acceptance criteria를 가지는지 (필드 또는 별도 섹션)."""
    if "acceptance" in meta and meta["acceptance"].strip():
        return True
    if ACCEPTANCE_HINT_RE.search(block):
        return True
    return False


def _depends_list(meta: dict) -> list[str]:
    raw = meta.get("depends", "").strip()
    if not raw or raw.lower() in {"-", "none", "n/a"}:
        return []
    # split by comma or whitespace
    parts = re.split(r"[,\s]+", raw)
    return [p.strip() for p in parts if p.strip()]


def _check_domain_mapping(domain: str, dev_config: dict | None) -> tuple[bool, str]:
    """domain이 dev-config에 매핑되어 단위/E2E 테스트 명령이 있는지."""
    if not domain or domain.lower() in {"-", "n/a", "default"}:
        # default domain — assume always ok
        return True, "default domain"
    if dev_config is None:
        return True, "dev-config not provided (skipped)"
    domains = dev_config.get("domains", {})
    if domain not in domains:
        return False, f"domain '{domain}' not in dev-config.domains"
    return True, "mapped"


def _has_quant_or_vague(block: str) -> list[dict]:
    """Task 본문에서 모호 동사가 정량 기준 없이 사용된 줄을 반환."""
    issues: list[dict] = []
    for line_no, line in enumerate(block.splitlines(), start=1):
        # Skip metadata lines
        if META_LINE_RE.match(line):
            continue
        if QUANT_HINT_RE.search(line):
            continue
        lower = line.lower()
        for verb in VAGUE_VERBS:
            if verb in lower or verb in line:
                issues.append({
                    "type": "vague_action",
                    "verb": verb,
                    "context": line.strip()[:120],
                })
                break
    return issues


# ---------------------------------------------------------------------------
# Validate
# ---------------------------------------------------------------------------


def validate_wbs(content: str, dev_config: dict | None = None) -> dict:
    blocks = _split_tasks(content)
    all_ids = {b["id"] for b in blocks}
    issues: list[dict] = []

    for b in blocks:
        meta = _parse_meta(b["block"])
        tid = b["id"]
        line = b["line"]

        # 1. acceptance
        if not _has_acceptance(b["block"], meta):
            issues.append({
                "task": tid, "line": line,
                "type": "missing_acceptance",
                "detail": "no 'acceptance' field or '수락 기준/Acceptance' subsection",
            })

        # 2. depends completeness
        for dep in _depends_list(meta):
            if dep not in all_ids:
                issues.append({
                    "task": tid, "line": line,
                    "type": "depends_unknown",
                    "detail": f"depends references {dep!r} which is not in WBS",
                })

        # 3. domain mapping
        domain = meta.get("domain", "")
        ok, reason = _check_domain_mapping(domain, dev_config)
        if not ok:
            issues.append({
                "task": tid, "line": line,
                "type": "test_unmapped",
                "detail": reason,
            })

        # 4. vague verbs
        # Only count up to first 3 to avoid noise
        vague = _has_quant_or_vague(b["block"])[:3]
        for v in vague:
            issues.append({
                "task": tid, "line": line,
                "type": "vague_action",
                "verb": v["verb"],
                "context": v["context"],
            })

    summary: dict[str, int] = {}
    for it in issues:
        summary[it["type"]] = summary.get(it["type"], 0) + 1
    summary["total"] = len(issues)
    summary["task_count"] = len(blocks)

    return {
        "ok": len(issues) == 0,
        "summary": summary,
        "issues": issues,
    }


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="wbs-validate.py",
        description="WBS Task 품질 검사",
    )
    sub = parser.add_subparsers(dest="cmd", required=True)

    vd = sub.add_parser("validate", help="WBS 정합성 검사")
    vd.add_argument("--wbs", required=True)
    vd.add_argument(
        "--dev-config-json",
        default=None,
        help="dev-config JSON (wbs-parse.py --dev-config 출력)",
    )

    args = parser.parse_args(argv)

    if args.cmd == "validate":
        path = Path(args.wbs)
        if not path.is_file():
            print(json.dumps({"ok": False, "error": f"wbs not found: {path}"}), file=sys.stderr)
            return 2
        content = path.read_text(encoding="utf-8")
        dev_config = None
        if args.dev_config_json:
            try:
                dev_config = json.loads(args.dev_config_json)
            except json.JSONDecodeError as e:
                print(json.dumps({"ok": False, "error": f"--dev-config-json parse error: {e}"}), file=sys.stderr)
                return 2
        result = validate_wbs(content, dev_config)
        result["target"] = str(path)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0 if result["ok"] else 1

    parser.print_help()
    return 1


if __name__ == "__main__":
    sys.exit(main())
