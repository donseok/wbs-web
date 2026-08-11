#!/usr/bin/env python3
"""decision-log.py — 자율 결정 감사 로그 헬퍼

LLM이 모호한 상황에서 자율적으로 내린 결정을 task/feature/project 디렉터리의
``decisions.md``에 append-only 방식으로 기록한다. 사후 감사를 위해 진행단계 /
결정해야할 내용 / 결정사항 / 판단 근거 4-필드를 강제한다.

서브커맨드:
  append --target DIR --phase P --decision-needed D --decision-made M --rationale R [--reversible yes|no] [--source S] [--scope-label LABEL]
                                  타겟 디렉터리의 decisions.md에 항목 append
  list --target DIR              decisions.md의 모든 항목 JSON 출력
  validate --target DIR          포맷 정합성 검사 (D-N 누락, 필드 누락 등)

Phase 화이트리스트:
  design | build | test | refactor | wbs | feat-intake | prd-resolve | dev-team-merge | wbs-resolve

Python stdlib only.
"""
from __future__ import annotations

import argparse
import datetime
import json
import re
import sys
from pathlib import Path

DECISIONS_FILE = "decisions.md"

ALLOWED_PHASES = {
    "design",
    "build",
    "test",
    "refactor",
    "wbs",
    "wbs-resolve",
    "feat-intake",
    "prd-resolve",
    "dev-team-merge",
}

ALLOWED_REVERSIBLE = {"yes", "no"}

ENTRY_RE = re.compile(r"^## D-(\d+) \(([^)]+)\)\s*$", re.MULTILINE)
FIELD_RE = re.compile(r"^- \*\*(?P<key>[^*]+)\*\*:\s*(?P<val>.*?)\s*$", re.MULTILINE)

REQUIRED_FIELDS = {
    "Phase",
    "Decision needed",
    "Decision made",
    "Rationale",
}
OPTIONAL_FIELDS = {"Reversible", "Source"}


# ---------------------------------------------------------------------------
# IO helpers
# ---------------------------------------------------------------------------


def _write(path: Path, content: str) -> None:
    """UTF-8 + LF 강제 쓰기."""
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(content)


def _utc_iso() -> str:
    """UTC ISO-8601 timestamp, second precision, with trailing 'Z'."""
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _scope_label_from_dir(target: Path) -> str:
    """타겟 디렉터리 경로에서 사람이 읽기 좋은 라벨 도출.

    docs/tasks/TSK-04-02 → "TSK-04-02"
    docs/features/auth → "feature: auth"
    docs/ → "project"
    """
    parts = target.resolve().parts
    if "tasks" in parts:
        i = parts.index("tasks")
        if i + 1 < len(parts):
            return parts[i + 1]
    if "features" in parts:
        i = parts.index("features")
        if i + 1 < len(parts):
            return f"feature: {parts[i + 1]}"
    return "project"


# ---------------------------------------------------------------------------
# parse / append
# ---------------------------------------------------------------------------


def _parse_entries(content: str) -> list[dict]:
    """decisions.md 내용을 파싱해 entry 리스트 반환.

    각 entry: {"id": int, "timestamp": str, "fields": {key: val, ...}, "raw": str}
    """
    entries: list[dict] = []
    matches = list(ENTRY_RE.finditer(content))
    for idx, m in enumerate(matches):
        entry_id = int(m.group(1))
        timestamp = m.group(2)
        body_start = m.end()
        body_end = matches[idx + 1].start() if idx + 1 < len(matches) else len(content)
        body = content[body_start:body_end]
        fields: dict[str, str] = {}
        for fm in FIELD_RE.finditer(body):
            fields[fm.group("key").strip()] = fm.group("val").strip()
        entries.append(
            {
                "id": entry_id,
                "timestamp": timestamp,
                "fields": fields,
                "raw": content[m.start():body_end].rstrip(),
            }
        )
    return entries


def _next_id(entries: list[dict]) -> int:
    if not entries:
        return 1
    return max(e["id"] for e in entries) + 1


def _format_entry(
    entry_id: int,
    timestamp: str,
    phase: str,
    decision_needed: str,
    decision_made: str,
    rationale: str,
    reversible: str | None,
    source: str | None,
) -> str:
    lines = [
        f"## D-{entry_id:03d} ({timestamp})",
        f"- **Phase**: {phase}",
        f"- **Decision needed**: {decision_needed}",
        f"- **Decision made**: {decision_made}",
        f"- **Rationale**: {rationale}",
    ]
    if reversible is not None:
        lines.append(f"- **Reversible**: {reversible}")
    if source is not None:
        lines.append(f"- **Source**: {source}")
    return "\n".join(lines) + "\n"


def append_decision(
    target: Path,
    phase: str,
    decision_needed: str,
    decision_made: str,
    rationale: str,
    reversible: str | None = None,
    source: str | None = None,
    scope_label: str | None = None,
    timestamp: str | None = None,
) -> dict:
    """decisions.md에 항목을 append. 파일 없으면 헤더와 함께 생성.

    반환: {"id": N, "timestamp": "...", "path": "..."}
    """
    if phase not in ALLOWED_PHASES:
        raise ValueError(
            f"phase '{phase}' not in allowed set: {sorted(ALLOWED_PHASES)}"
        )
    if reversible is not None and reversible not in ALLOWED_REVERSIBLE:
        raise ValueError(f"reversible must be 'yes' or 'no', got '{reversible}'")
    for label, value in [
        ("decision_needed", decision_needed),
        ("decision_made", decision_made),
        ("rationale", rationale),
    ]:
        if not value or not value.strip():
            raise ValueError(f"{label} must be non-empty")

    target.mkdir(parents=True, exist_ok=True)
    decisions_path = target / DECISIONS_FILE
    label = scope_label or _scope_label_from_dir(target)
    ts = timestamp or _utc_iso()

    if decisions_path.exists():
        existing = decisions_path.read_text(encoding="utf-8")
        entries = _parse_entries(existing)
        next_id = _next_id(entries)
        entry_block = _format_entry(
            next_id, ts, phase, decision_needed, decision_made,
            rationale, reversible, source,
        )
        if not existing.endswith("\n"):
            existing += "\n"
        new_content = existing + "\n" + entry_block
    else:
        next_id = 1
        header = (
            f"# Decisions Log — {label}\n\n"
            "> Append-only audit trail of autonomous decisions made during DDTR/feat/wbs cycles.\n"
            "> Edit prior entries forbidden — record reversals as new entries instead.\n\n"
        )
        entry_block = _format_entry(
            next_id, ts, phase, decision_needed, decision_made,
            rationale, reversible, source,
        )
        new_content = header + entry_block

    _write(decisions_path, new_content)
    return {"id": next_id, "timestamp": ts, "path": str(decisions_path)}


# ---------------------------------------------------------------------------
# list / validate
# ---------------------------------------------------------------------------


def list_decisions(target: Path) -> list[dict]:
    """decisions.md의 모든 항목을 dict 리스트로 반환. 파일 없으면 []."""
    decisions_path = target / DECISIONS_FILE
    if not decisions_path.exists():
        return []
    content = decisions_path.read_text(encoding="utf-8")
    entries = _parse_entries(content)
    return [
        {
            "id": e["id"],
            "timestamp": e["timestamp"],
            **{k.lower().replace(" ", "_"): v for k, v in e["fields"].items()},
        }
        for e in entries
    ]


def validate_decisions(target: Path) -> dict:
    """decisions.md 정합성 검사.

    검사 항목:
      - id 연속성 (D-001, D-002, ...)
      - 필수 필드(Phase, Decision needed, Decision made, Rationale) 존재
      - phase 화이트리스트 적합

    반환: {"ok": bool, "errors": [str, ...], "entry_count": int}
    """
    decisions_path = target / DECISIONS_FILE
    if not decisions_path.exists():
        return {"ok": True, "errors": [], "entry_count": 0}

    content = decisions_path.read_text(encoding="utf-8")
    entries = _parse_entries(content)
    errors: list[str] = []

    for idx, e in enumerate(entries, start=1):
        if e["id"] != idx:
            errors.append(f"D-{e['id']:03d}: expected id {idx} (id sequence broken)")
        missing = REQUIRED_FIELDS - set(e["fields"].keys())
        if missing:
            errors.append(f"D-{e['id']:03d}: missing fields {sorted(missing)}")
        phase = e["fields"].get("Phase", "").strip()
        if phase and phase not in ALLOWED_PHASES:
            errors.append(f"D-{e['id']:03d}: phase '{phase}' not in allowed set")
        rev = e["fields"].get("Reversible")
        if rev is not None and rev.strip() not in ALLOWED_REVERSIBLE:
            errors.append(f"D-{e['id']:03d}: reversible '{rev}' not in {{yes,no}}")

    return {"ok": not errors, "errors": errors, "entry_count": len(entries)}


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="decision-log.py",
        description="자율 결정 감사 로그 헬퍼",
    )
    sub = parser.add_subparsers(dest="cmd", required=True)

    ap = sub.add_parser("append", help="decisions.md에 항목 append")
    ap.add_argument("--target", required=True, help="task/feature/project 디렉터리")
    ap.add_argument("--phase", required=True, choices=sorted(ALLOWED_PHASES))
    ap.add_argument("--decision-needed", required=True)
    ap.add_argument("--decision-made", required=True)
    ap.add_argument("--rationale", required=True)
    ap.add_argument("--reversible", choices=["yes", "no"], default=None)
    ap.add_argument("--source", default=None, help="파일:라인 또는 commit SHA")
    ap.add_argument("--scope-label", default=None, help="헤더 라벨 override")

    ls = sub.add_parser("list", help="모든 항목 JSON 출력")
    ls.add_argument("--target", required=True)

    vl = sub.add_parser("validate", help="포맷 정합성 검사")
    vl.add_argument("--target", required=True)

    args = parser.parse_args(argv)

    if args.cmd == "append":
        try:
            result = append_decision(
                target=Path(args.target),
                phase=args.phase,
                decision_needed=args.decision_needed,
                decision_made=args.decision_made,
                rationale=args.rationale,
                reversible=args.reversible,
                source=args.source,
                scope_label=args.scope_label,
            )
        except ValueError as e:
            print(json.dumps({"ok": False, "error": str(e)}), file=sys.stderr)
            return 2
        print(json.dumps({"ok": True, **result}, ensure_ascii=False))
        return 0

    if args.cmd == "list":
        result = list_decisions(Path(args.target))
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0

    if args.cmd == "validate":
        result = validate_decisions(Path(args.target))
        print(json.dumps(result, ensure_ascii=False))
        return 0 if result["ok"] else 1

    parser.print_help()
    return 1


if __name__ == "__main__":
    sys.exit(main())
