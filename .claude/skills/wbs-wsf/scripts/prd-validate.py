#!/usr/bin/env python3
"""prd-validate.py — PRD/TRD 정합성 검사

상류 품질 게이트의 첫 번째 단계. PRD/TRD에 모호 표현·placeholder·누락 섹션이
있는지 검출해 다운스트림(/wbs, /dev, /feat)이 모호 요구로 작업하지 않도록 한다.
실제 자동 보강은 LLM이 수행하며 — 이 스크립트는 issue를 JSON으로 보고할 뿐이다.

검출 항목:
  1. Placeholder    TBD / TODO / ??? / <…>
  2. Vague metrics  "fast" / "scalable" / "user-friendly" 등 정량 기준 없는 형용사
  3. Missing sections  acceptance criteria / NFR / constraints / glossary

서브커맨드:
  validate --target FILE [--required-sections KEY1,KEY2,...]
                                  PRD/TRD 정합성 검사 → JSON
  assumptions-template --target FILE
                                  ## Assumptions (auto-resolved YYYY-MM-DD) 템플릿 출력

사용:
  prd-validate.py validate --target docs/PRD.md
  prd-validate.py validate --target docs/TRD.md \\
    --required-sections "acceptance criteria,NFR,constraints"

종료 코드:
  0  ok=true (issue 없음)
  1  ok=false (issue 1개 이상)
  2  사용 오류
"""
from __future__ import annotations

import argparse
import datetime
import json
import re
import sys
from pathlib import Path

PLACEHOLDER_PATTERNS = [
    (re.compile(r"\bTBD\b", re.IGNORECASE), "TBD"),
    (re.compile(r"\bTODO\b", re.IGNORECASE), "TODO"),
    (re.compile(r"\?{3,}"), "???"),
    (re.compile(r"<[A-Z_][A-Z0-9_ -]{2,}>"), "<PLACEHOLDER>"),
]

VAGUE_TERMS = [
    "fast", "scalable", "user-friendly", "intuitive", "robust",
    "efficient", "modern", "seamless", "smooth", "easy",
    "high performance", "low latency", "best-in-class",
    "world-class", "blazing", "lightning",
    # Korean
    "빠른", "빠르게", "쉬운", "사용자 친화", "직관적", "효율적", "원활",
]

DEFAULT_REQUIRED_SECTIONS = [
    "acceptance criteria",
    "non-functional requirements",
    "constraints",
]

# Section name aliases (normalized → list of regex alternatives)
SECTION_ALIASES = {
    "acceptance criteria": [
        r"acceptance\s*criteria", r"수락\s*기준", r"완료\s*조건",
    ],
    "non-functional requirements": [
        r"non[\- ]?functional\s*requirements", r"\bNFR\b",
        r"비\s*기능\s*요구", r"성능[/\s]?품질[/\s]?보안",
    ],
    "constraints": [
        r"constraints?", r"제약\s*사항", r"제약\s*조건",
    ],
    "glossary": [r"glossary", r"용어\s*정의", r"용어집"],
}

QUANT_HINT_RE = re.compile(
    r"\b\d+\s*(ms|s|sec|seconds?|minutes?|hours?|%|p\d+|MB|GB|TB|KB|bytes?|"
    r"req(/s)?|qps|tps|rps|kgs?|users?|MAU|DAU)\b",
    re.IGNORECASE,
)


def _utc_iso_date() -> str:
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d")


# ---------------------------------------------------------------------------
# Detectors
# ---------------------------------------------------------------------------


def find_placeholders(content: str) -> list[dict]:
    issues: list[dict] = []
    for line_no, line in enumerate(content.splitlines(), start=1):
        # Skip code blocks (heuristic — would need tokenizer for full accuracy)
        for pattern, label in PLACEHOLDER_PATTERNS:
            for m in pattern.finditer(line):
                issues.append({
                    "type": "placeholder",
                    "label": label,
                    "line": line_no,
                    "match": m.group(0),
                    "context": line.strip()[:120],
                })
    return issues


def find_vague_metrics(content: str) -> list[dict]:
    """모호 형용사가 정량 hint 없이 등장하는 줄을 검출."""
    issues: list[dict] = []
    for line_no, line in enumerate(content.splitlines(), start=1):
        lower = line.lower()
        # If line has any quantitative hint (numbers + units), accept it
        if QUANT_HINT_RE.search(line):
            continue
        for term in VAGUE_TERMS:
            if term.lower() in lower:
                pos = lower.find(term.lower())
                issues.append({
                    "type": "vague_metric",
                    "term": term,
                    "line": line_no,
                    "match": line[pos: pos + len(term)],
                    "context": line.strip()[:120],
                })
                break  # one issue per line
    return issues


def find_missing_sections(content: str, required: list[str]) -> list[dict]:
    """필수 섹션 헤더가 존재하는지 (대소문자/언어 무관) 검사."""
    issues: list[dict] = []
    for canonical in required:
        aliases = SECTION_ALIASES.get(canonical, [re.escape(canonical)])
        # Match any heading line: ^#{1,6}\s+...alias...
        found = False
        for alias in aliases:
            pattern = re.compile(
                rf"^#{{1,6}}\s+.*\b({alias})\b", re.MULTILINE | re.IGNORECASE,
            )
            if pattern.search(content):
                found = True
                break
        if not found:
            issues.append({
                "type": "missing_section",
                "section": canonical,
            })
    return issues


def validate_file(path: Path, required_sections: list[str]) -> dict:
    if not path.is_file():
        return {
            "ok": False,
            "error": f"file not found: {path}",
            "issues": [],
        }
    content = path.read_text(encoding="utf-8")
    placeholders = find_placeholders(content)
    vague = find_vague_metrics(content)
    missing = find_missing_sections(content, required_sections)
    issues = placeholders + vague + missing
    return {
        "ok": len(issues) == 0,
        "target": str(path),
        "summary": {
            "placeholder_count": len(placeholders),
            "vague_count": len(vague),
            "missing_section_count": len(missing),
            "total": len(issues),
        },
        "issues": issues,
    }


# ---------------------------------------------------------------------------
# Assumptions template
# ---------------------------------------------------------------------------


ASSUMPTIONS_TEMPLATE = """\
## Assumptions (auto-resolved {date})

> 이 섹션은 dev-plugin의 자율 결정으로 보강된 가정 목록이다. 원본 PRD/TRD가 명시하지 않은 항목을 합리적으로 채워 넣은 결과로, 사후 변경이 필요하면 PRD를 수정한 뒤 `/wbs`를 재실행한다.
>
> 각 항목은 `docs/decisions.md`에도 entry가 추가되어 있다 (`scripts/decision-log.py list --target docs` 로 확인 가능).

- (placeholder) 보강된 가정을 한 줄씩 기록
"""


def assumptions_template() -> str:
    return ASSUMPTIONS_TEMPLATE.format(date=_utc_iso_date())


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="prd-validate.py",
        description="PRD/TRD 정합성 검사",
    )
    sub = parser.add_subparsers(dest="cmd", required=True)

    vd = sub.add_parser("validate", help="정합성 검사 → JSON")
    vd.add_argument("--target", required=True)
    vd.add_argument(
        "--required-sections",
        default=",".join(DEFAULT_REQUIRED_SECTIONS),
        help="콤마 구분 필수 섹션 (기본: acceptance criteria,NFR,constraints)",
    )

    at = sub.add_parser("assumptions-template", help="## Assumptions 섹션 템플릿 출력")
    at.add_argument("--target", help="(unused, reserved for future use)")

    args = parser.parse_args(argv)

    if args.cmd == "validate":
        required = [s.strip() for s in args.required_sections.split(",") if s.strip()]
        result = validate_file(Path(args.target), required)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0 if result["ok"] else 1

    if args.cmd == "assumptions-template":
        print(assumptions_template())
        return 0

    parser.print_help()
    return 1


if __name__ == "__main__":
    sys.exit(main())
