#!/usr/bin/env python3
"""N단 wbs.md 파서 — 검증(validate) + import v2.2 payload(export).

계약 정본: docs/superpowers/specs/2026-08-21-wbs-nlevel-md-contract.md §import 계약 v2.2
- 단계 판정은 접두어(frontmatter levels 의 prefix)가 정본, 헤딩/들여쓰기는 부모 판정용.
- fold 층(STK)은 노드로 내보내지 않고 부모 acceptance 로 접는다: "[ ] 제목" / "[x] 제목".
- rollup 층 leaf 는 파일 단위 경고(분리 업로드 과도기 정상 — 합본 검증은 서버·후속 도구 몫).

사용:
  python3 wbs-nlevel-parse.py validate --wbs docs/mes/조업/wbs.md --role pl
  python3 wbs-nlevel-parse.py export --wbs docs/mes/조업/wbs.md --attach-ref mes-skel/SYS-OP
  python3 wbs-nlevel-parse.py export --wbs docs/mes/조업/wbs.md --skeleton docs/mes/skel/wbs.md
"""
from __future__ import annotations

import argparse
import json
import datetime
import re
import sys

# ── frontmatter ──────────────────────────────────────────────────────────

_FLOW_MAP_RE = re.compile(r"^\s*-\s*\{(.+)\}\s*$")
_CREDIT_RE = re.compile(r"^\s{2}(\S+):\s*\{(.+)\}\s*$")
_KV_RE = re.compile(r"^([A-Za-z_][\w-]*):\s*(.*?)\s*(?:#.*)?$")


def _parse_flow_map(inner: str) -> dict:
    out = {}
    for part in inner.split(","):
        if ":" not in part:
            continue
        k, v = part.split(":", 1)
        v = v.strip()
        if v == "true":
            v = True
        elif v == "false":
            v = False
        elif re.fullmatch(r"-?\d+", v):
            v = int(v)
        out[k.strip()] = v
    return out


def _parse_frontmatter(lines: list[str]) -> dict:
    front: dict = {"levels": [], "credits": {}}
    section = None
    for raw in lines:
        line = raw.split("#", 1)[0].rstrip() if not raw.lstrip().startswith("#") else ""
        if not line.strip():
            continue
        fm = _FLOW_MAP_RE.match(line)
        if fm and section == "levels":
            front["levels"].append(_parse_flow_map(fm.group(1)))
            continue
        cm = _CREDIT_RE.match(raw)
        if cm and section == "credits":
            front["credits"][cm.group(1)] = _parse_flow_map(cm.group(2))
            continue
        kv = _KV_RE.match(line)
        if kv:
            key, val = kv.group(1), kv.group(2)
            if key in ("levels", "credits") and val == "":
                section = key
            else:
                section = None
                front[key] = val
    return front


# ── 본문 ─────────────────────────────────────────────────────────────────

_HEADING_RE = re.compile(r"^(#{1,6})\s+(.+?)\s*$")
_ITEM_RE = re.compile(r"^(\s*)-\s+(.+?)\s*$")
_ID_TITLE_RE = re.compile(r"^([A-Z][A-Z0-9]*(?:-[^\s:]+)*):\s*(.+)$")
_CHECKBOX_RE = re.compile(r"^\[( |x|M)\]\s+(.+)$")
_FIELD_KEYS = {
    "category", "domain", "model", "priority", "tags", "depends",
    "prd-ref", "entry-point", "requirements", "acceptance",
}
_TOKEN_RES = {
    "assignee": re.compile(r"\s+@(\S+)"),
    "weight": re.compile(r"\s+w:([\d.]+)"),
    "end": re.compile(r"\s+~(\d{4}-\d{2}-\d{2})"),
    "credit": re.compile(r"\s+credit:(\S+)"),
    "if_id": re.compile(r"\s+if-id:(\S+)"),
}


# `시작~종료` 범위 토큰 — 종료 단독(`~종료`)보다 먼저 떼어낸다(2026-08-24: 시작일 없는 WBS 는 간트가 비어 있었다)
_RANGE_RE = re.compile(r"\s+(\d{4}-\d{2}-\d{2})\s*~\s*(\d{4}-\d{2}-\d{2})")


def next_business_day(ymd: str) -> str:
    """다음 영업일(토·일 건너뜀). 공휴일은 모른다."""
    d = datetime.date.fromisoformat(ymd)
    while True:
        d += datetime.timedelta(days=1)
        if d.weekday() < 5:
            return d.isoformat()


def _extract_tokens(text: str) -> tuple[str, dict]:
    tokens: dict = {}
    rm = _RANGE_RE.search(text)
    if rm:
        tokens["start"], tokens["end"] = rm.group(1), rm.group(2)
        text = _RANGE_RE.sub("", text, count=1)
    for name, rx in _TOKEN_RES.items():
        mm = rx.search(text)
        if mm:
            tokens[name] = mm.group(1)
            text = rx.sub("", text, count=1)
    return re.sub(r"\s+", " ", text).strip(), tokens


def parse_wbs(md: str) -> dict:
    lines = md.splitlines()
    # frontmatter 분리
    front_lines: list[str] = []
    body_start = 0
    if lines and lines[0].strip() == "---":
        for i in range(1, len(lines)):
            if lines[i].strip() == "---":
                front_lines = lines[1:i]
                body_start = i + 1
                break
    front = _parse_frontmatter(front_lines)
    levels = front.get("levels", [])
    prefix_to_idx = {l["prefix"]: i for i, l in enumerate(levels) if "prefix" in l}

    nodes: list[dict] = []
    problems: list[str] = []
    heading_stack: list[tuple[int, dict]] = []  # (heading depth, node)
    item_stack: list[tuple[int, dict]] = []     # (indent, node)
    in_comment = False

    def _mk_node(nid, title, level, parent, *, checked=None, milestone=False, tokens=None):
        node = {
            "id": nid, "title": title, "level": level,
            "parent": parent["id"] if parent else None,
            "checked": checked, "milestone": milestone,
            "tokens": tokens or {}, "fields": {}, "stks": [],
        }
        nodes.append(node)
        return node

    for raw in lines[body_start:]:
        line = raw.rstrip("\n")
        # 주석 스킵(여러 줄 지원)
        if in_comment:
            if "-->" in line:
                in_comment = False
            continue
        if line.lstrip().startswith("<!--"):
            if "-->" not in line:
                in_comment = True
            continue

        hm = _HEADING_RE.match(line)
        if hm:
            depth = len(hm.group(1))
            idm = _ID_TITLE_RE.match(hm.group(2))
            if not idm:
                continue  # 문서 제목 등 ID 없는 헤딩
            nid = idm.group(1)
            title, tokens = _extract_tokens(idm.group(2))
            prefix = nid.split("-", 1)[0]
            while heading_stack and heading_stack[-1][0] >= depth:
                heading_stack.pop()
            parent = heading_stack[-1][1] if heading_stack else None
            level = prefix_to_idx.get(prefix)
            if level is None:
                problems.append(f"미선언 접두어: {nid} (levels 의 prefix 에 없음)")
                continue
            node = _mk_node(nid, title, level, parent, tokens=tokens)
            heading_stack.append((depth, node))
            item_stack.clear()
            continue

        im = _ITEM_RE.match(line)
        if not im:
            continue
        indent, content = len(im.group(1)), im.group(2)
        while item_stack and item_stack[-1][0] >= indent:
            item_stack.pop()
        owner = item_stack[-1][1] if item_stack else None

        cb = _CHECKBOX_RE.match(content)
        if cb:
            mark, rest = cb.group(1), cb.group(2)
            idm = _ID_TITLE_RE.match(rest)
            if not idm:
                if mark == "M":
                    problems.append(f"마일스톤에 ID 필요: {rest!r} — '- [M] {{접두어 ID}}: 제목' 형식")
                else:
                    problems.append(f"체크 항목에 ID 필요: {rest!r}")
                continue
            nid = idm.group(1)
            title, tokens = _extract_tokens(idm.group(2))
            prefix = nid.split("-", 1)[0]
            level = prefix_to_idx.get(prefix)
            if level is None:
                problems.append(f"미선언 접두어: {nid} (levels 의 prefix 에 없음)")
                continue
            parent = owner if owner else (heading_stack[-1][1] if heading_stack else None)
            node = _mk_node(
                nid, title, level, parent,
                checked=(mark == "x"), milestone=(mark == "M"), tokens=tokens,
            )
            item_stack.append((indent, node))
            continue

        # 상세 블록 필드: "- key: value" (체크박스 없음)
        kv = content.split(":", 1)
        if len(kv) == 2 and kv[0].strip() in _FIELD_KEYS and owner is not None:
            owner["fields"][kv[0].strip()] = kv[1].strip()
            continue
        # 그 외 리스트 줄은 무시(자유 메모)

    return {"front": front, "levels": levels, "nodes": nodes, "problems": problems}


# ── 검증 ─────────────────────────────────────────────────────────────────

_PCT_RE = re.compile(r"\d+\s*%")


def validate(doc: dict, role: str = "pl") -> dict:
    errors: list[str] = list(doc["problems"])
    warnings: list[str] = []
    levels = doc["levels"]
    front = doc["front"]
    nodes = doc["nodes"]
    by_id: dict[str, dict] = {}

    if not levels:
        errors.append("frontmatter levels 가 없습니다 — 단계 선언은 frontmatter 에서만 한다.")
        return {"ok": False, "errors": errors, "warnings": warnings, "counts": {}}

    if role == "pl":
        if not front.get("attach"):
            errors.append("PL 파일에 attach 가 없습니다 (frontmatter attach: {골격 경로}).")
        if not front.get("module"):
            errors.append("PL 파일에 module 이 없습니다.")

    for n in nodes:
        if n["id"] in by_id:
            errors.append(f"ID 중복: {n['id']}")
        by_id[n["id"]] = n

    children: dict[str, list[dict]] = {}
    for n in nodes:
        if n["parent"]:
            children.setdefault(n["parent"], []).append(n)

    # attach 지점 밑에서 시작해야 하는 최소 레벨(role=pl)
    attach_min_level = -1
    if role == "pl" and front.get("attach"):
        last = str(front["attach"]).split("/")[-1]
        attach_min_level = {l.get("prefix"): i for i, l in enumerate(levels)}.get(last.split("-", 1)[0], -1)

    for n in nodes:
        lv = levels[n["level"]]
        # PL 파일에 골격 층(upload:false / owner:pmo) 본문 금지
        if role == "pl" and (lv.get("upload") is False or lv.get("owner") == "pmo"):
            errors.append(f"{n['id']}: 골격 층({lv.get('name')})은 PL 파일 본문에 쓸 수 없다 — 골격 소유.")
        # 자식 순번 > 부모 순번
        if n["parent"]:
            p = by_id.get(n["parent"])
            if p is not None and n["level"] <= p["level"]:
                errors.append(f"{n['id']}: 단계 순번 역행/동급 — 부모 {p['id']}({p['level']}) 이하가 아님({n['level']}).")
            elif p is not None:
                for i in range(p["level"] + 1, n["level"]):
                    if not levels[i].get("optional"):
                        warnings.append(f"{n['id']}: 필수층 {levels[i].get('name')} 건너뜀 (부모 {p['id']}).")
        elif attach_min_level >= 0 and n["level"] <= attach_min_level:
            errors.append(f"{n['id']}: attach 지점({attach_min_level}층) 이하 층은 최상위에 올 수 없다.")
        # 상태·실적
        if n["checked"] and lv.get("progress") != "checklist":
            errors.append(f"{n['id']}: 상태는 항상 [ ] — [x] 는 checklist 층 전용(전이 정본은 D'Flow).")
        if _PCT_RE.search(n["title"]):
            errors.append(f"{n['id']}: 제목에 실적 % 금지 — 진도는 D'Flow 가 정본.")
        # checklist 층 leaf 전용 + 부모는 input 층
        if lv.get("progress") == "checklist":
            if children.get(n["id"]):
                errors.append(f"{n['id']}: checklist 층은 leaf 전용 — 자식 금지.")
            p = by_id.get(n["parent"]) if n["parent"] else None
            if p is None or levels[p["level"]].get("progress") != "input":
                errors.append(f"{n['id']}: checklist 의 부모는 input 층이어야 한다.")
        # rollup 층 leaf — 파일 단위 경고(합본 검증 아님)
        if lv.get("progress") == "rollup" and not children.get(n["id"]) and not n["milestone"]:
            warnings.append(f"{n['id']}: rollup 층 leaf (파일 단위 — 분리 업로드 과도기면 정상).")
        # depends 대상(파일 내) — 크로스 모듈은 여기서 못 본다 → 경고만
        deps = [d.strip() for d in n["fields"].get("depends", "").split(",") if d.strip()]
        for d in deps:
            if d not in by_id:
                warnings.append(f"{n['id']}: depends 대상 없음(파일 내): {d}")
        # credit 키
        credit = n["tokens"].get("credit")
        if credit and credit not in doc["front"].get("credits", {}):
            warnings.append(f"{n['id']}: credit 키 미정의: {credit}")

    counts: dict[str, int] = {}
    for n in nodes:
        name = str(levels[n["level"]].get("name"))
        counts[name] = counts.get(name, 0) + 1
    return {"ok": not errors, "errors": errors, "warnings": warnings, "counts": counts}


# ── export (import v2.2 payload) ─────────────────────────────────────────


def export_payload(doc: dict, attach_ref: str | None = None) -> dict:
    levels = doc["levels"]
    nodes_out = []
    by_id = {n["id"]: n for n in doc["nodes"]}
    for n in doc["nodes"]:
        lv = levels[n["level"]]
        if lv.get("upload") is False:
            continue
        if lv.get("upload") == "fold":
            # 부모 acceptance 로 접힘 — 노드로 내보내지 않는다
            p = by_id.get(n["parent"]) if n["parent"] else None
            if p is not None:
                p["stks"].append({"checked": bool(n["checked"]), "title": n["title"]})
            continue
        nodes_out.append(n)

    # 시작일 파생 — 종료만 적힌 노드(마일스톤 제외)는 선행(depends) 종료 다음 영업일,
    # 선행이 없거나 선행에 종료가 없으면 frontmatter start_date. 둘 다 없으면 None.
    end_of = {n["id"]: n["tokens"].get("end") for n in doc["nodes"]}
    start_date = doc["front"].get("start_date") or doc["front"].get("start-date")

    def _derived_start(n: dict) -> str | None:
        t = n["tokens"]
        if t.get("start"):
            return t["start"]
        if not t.get("end") or n["milestone"]:
            return None
        deps = [d.strip() for d in n["fields"].get("depends", "").split(",") if d.strip()]
        ends = [end_of.get(d) for d in deps]
        start = None
        if deps and all(ends):
            start = next_business_day(max(ends))  # type: ignore[type-var]
        elif start_date:
            start = str(start_date)
        if start and start > t["end"]:
            start = t["end"]  # 선행이 더 늦게 끝나는 계획 오류 — 막대는 그리되 0일로
        return start

    def _node_json(n: dict) -> dict:
        f, t = n["fields"], n["tokens"]
        start = _derived_start(n)
        acceptance = [s.strip() for s in f.get("acceptance", "").split(" / ") if s.strip()]
        acceptance += [("[x] " if s["checked"] else "[ ] ") + s["title"] for s in n["stks"]]
        req = f.get("requirements", "").strip()
        spec_sections = None
        if req:
            spec_sections = {
                "requirements": [req], "test_criteria": [], "constraints": [],
                "api_spec": None, "data_model": None, "description": None,
            }
        weight = t.get("weight")
        if weight is not None:
            weight = float(weight)
            if weight.is_integer():
                weight = int(weight)
        progress = levels[n["level"]].get("progress")
        kind = "task" if progress == "input" else ("phase" if n["level"] == 0 else "wp")
        return {
            "id": n["id"], "parent_id": n["parent"], "kind": kind,
            "title": n["title"], "stage": None,
            "level": n["level"], "weight": weight,
            "milestone": n["milestone"],
            "credit": t.get("credit"), "if_id": t.get("if_id"),
            "assignee": t.get("assignee"),
            "schedule": (f"{start} ~ {t['end']}" if start else f"~ {t['end']}") if t.get("end") else None,
            "depends": [d.strip() for d in f.get("depends", "").split(",") if d.strip()],
            "acceptance": acceptance,
            "tags": [s.strip() for s in f.get("tags", "").split(",") if s.strip()],
            "category": f.get("category"), "domain": f.get("domain"),
            "priority": f.get("priority"), "model": f.get("model"),
            "prd_ref": f.get("prd-ref"), "entry_point": f.get("entry-point"),
            "spec_sections": spec_sections,
        }

    payload = {
        "schema_version": "2.2",
        "module": doc["front"].get("module"),
        "levels": levels,
        "nodes": [_node_json(n) for n in nodes_out],
    }
    if attach_ref:
        payload["attach_ref"] = attach_ref
    return payload


# ── CLI ──────────────────────────────────────────────────────────────────


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    sub = ap.add_subparsers(dest="cmd", required=True)
    v = sub.add_parser("validate")
    v.add_argument("--wbs", required=True)
    v.add_argument("--role", choices=["pl", "skeleton"], default="pl")
    e = sub.add_parser("export")
    e.add_argument("--wbs", required=True)
    e.add_argument("--attach-ref")
    e.add_argument("--skeleton", help="골격 wbs.md 경로 — module 을 읽어 attach_ref 를 조립")
    args = ap.parse_args()

    doc = parse_wbs(open(args.wbs, encoding="utf-8").read())
    if args.cmd == "validate":
        out = validate(doc, role=args.role)
        print(json.dumps(out, ensure_ascii=False, indent=1))
        return 0 if out["ok"] else 1

    attach_ref = args.attach_ref
    attach = doc["front"].get("attach")
    if not attach_ref and attach and args.skeleton:
        skel = parse_wbs(open(args.skeleton, encoding="utf-8").read())
        skel_module = skel["front"].get("module")
        if not skel_module:
            print("골격 파일에 module 이 없습니다.", file=sys.stderr)
            return 1
        attach_ref = f"{skel_module}/{str(attach).split('/')[-1]}"
    if attach and not attach_ref:
        print("attach 파일인데 attach_ref 를 조립할 수 없습니다 — --attach-ref 또는 --skeleton 필요.", file=sys.stderr)
        return 1
    # 검증 게이트 — 에러가 있으면 export 하지 않는다(fail-closed)
    rep = validate(doc, role=("pl" if attach else "skeleton"))
    if not rep["ok"]:
        print(json.dumps(rep, ensure_ascii=False, indent=1), file=sys.stderr)
        return 1
    print(json.dumps(export_payload(doc, attach_ref=attach_ref), ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
