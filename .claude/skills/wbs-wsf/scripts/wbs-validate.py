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
import re
import sys
from pathlib import Path

# Task 헤딩: ### TSK-XX-YY: title
TASK_HEADING_RE = re.compile(r"^###\s+(TSK-\d+-\d+):\s*(.*)$", re.MULTILINE)

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
    """wbs.md를 Task 블록 리스트로 분리."""
    matches = list(TASK_HEADING_RE.finditer(content))
    blocks: list[dict] = []
    for idx, m in enumerate(matches):
        start = m.start()
        end = matches[idx + 1].start() if idx + 1 < len(matches) else len(content)
        block = content[start:end]
        # Compute starting line number
        line_start = content[:start].count("\n") + 1
        blocks.append({
            "id": m.group(1),
            "title": m.group(2).strip(),
            "line": line_start,
            "block": block,
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
