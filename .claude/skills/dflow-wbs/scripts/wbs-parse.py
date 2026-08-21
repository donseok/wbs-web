#!/usr/bin/env python3
"""wbs-parse.py — Extract Task/WP information from WBS file as structured output.

Replaces wbs-parse.sh for cross-platform support.
Output format is identical JSON.
"""
import sys
import os
import re
import json

USAGE = """\
Usage: wbs-parse.py <wbs-path> <ID> [mode]

Modes:
  (default)              Task/WP full fields as JSON
  --block                Task block raw text
  --field <name>         Single field value
  --tasks                WP child Task list (JSON array)
  --tasks-pending        WP child incomplete Tasks only (status != [xx], category != feat)
  --tasks-all            All Tasks across every WP (flat array, no target_id, includes category field)
  --feat-tasks           WP child Tasks with category=feat only → [{"tsk_id","feat_name","title"}]
  --resumable-wps        Executable WP list (WPs with incomplete Tasks)
  --phase-start          Start phase based on Task's current status
  --dev-config           Extract ## Dev Config section as JSON
  --complexity           Compute complexity score and recommended design model

Feature mode:
  wbs-parse.py --feat <feat-dir> --phase-start
  wbs-parse.py --feat <feat-dir> --status
  wbs-parse.py --feat <feat-dir> --dev-config [docs-dir]
      Fallback chain: <feat-dir>/dev-config.md → <docs-dir>/wbs.md → default-dev-config.md

Examples:
  wbs-parse.py docs/wbs.md TSK-01-02
  wbs-parse.py docs/wbs.md TSK-01-02 --block
  wbs-parse.py docs/wbs.md TSK-01-02 --field domain
  wbs-parse.py docs/wbs.md WP-01 --tasks
  wbs-parse.py docs/wbs.md --tasks-all
  wbs-parse.py docs/wbs.md - --resumable-wps
  wbs-parse.py docs/wbs.md TSK-01-02 --phase-start
  wbs-parse.py docs/wbs.md - --dev-config
  wbs-parse.py --feat docs/features/login-2fa --phase-start
  wbs-parse.py --feat docs/features/login-2fa --status
  wbs-parse.py --feat docs/features/login-2fa --dev-config docs
"""


def json_escape(s: str) -> str:
    s = s.replace("\\", "\\\\")
    s = s.replace('"', '\\"')
    s = s.replace("\n", "\\n")
    s = s.replace("\t", "\\t")
    return s


def extract_task_block(wbs_text: str, tsk_id: str) -> str:
    """Extract a task block (### or #### level) from WBS text."""
    lines = wbs_text.splitlines()
    result = []
    found = False
    level = 0

    for line in lines:
        # Calculate heading level
        hl = 0
        for ch in line:
            if ch == "#":
                hl += 1
            else:
                break

        # Match target TSK heading
        if not found and hl >= 2 and f"{tsk_id}:" in line:
            found = True
            level = hl
            result.append(line)
            continue

        # End at same or higher level heading
        if found and hl >= 2 and hl <= level and f"{tsk_id}:" not in line:
            break

        if found:
            result.append(line)

    return "\n".join(result)


def extract_wp_block(wbs_text: str, wp_id: str) -> str:
    """Extract a WP block (## level) from WBS text."""
    lines = wbs_text.splitlines()
    result = []
    found = False

    for line in lines:
        if line.startswith("## ") and f"{wp_id}:" in line:
            found = True
            result.append(line)
            continue
        if found and line.startswith("## "):
            break
        if found:
            result.append(line)

    return "\n".join(result)


def get_field(block: str, field_name: str) -> str:
    """Extract a single-line field value from a block.

    Matches ``- field: value`` on a single line. Returns "" if the field is
    absent or uses the multi-line bullet-list form (see ``parse_list_field``).
    """
    for line in block.splitlines():
        pattern = f"- {field_name}:"
        if line.startswith(pattern):
            return line[len(pattern):].strip()
    return ""


def parse_list_field(block: str, field_name: str) -> list:
    """Extract a list-valued field (single-line CSV or multi-line bullet list).

    Supports three shapes:
      1. ``- field: -``            → []  (explicit empty marker)
      2. ``- field: v1, v2, v3``   → ["v1", "v2", "v3"]  (inline CSV)
      3. ``- field:`` + ``  - item1`` lines → ["item1", ...]  (bullet list)
         Nested bullets (4+ space indent) are appended to the previous item as
         sub-detail, preserving the original text verbatim.
    """
    lines = block.splitlines()
    pattern = f"- {field_name}:"
    items: list = []
    capturing = False

    for line in lines:
        if not capturing:
            if line.startswith(pattern):
                inline = line[len(pattern):].strip()
                if inline and inline != "-":
                    # Inline CSV form
                    return [s.strip() for s in inline.split(",") if s.strip()]
                if inline == "-":
                    return []
                capturing = True
            continue

        stripped = line.strip()
        # Terminate when a new top-level ``- name:`` field appears
        if re.match(r"^- [a-zA-Z][a-zA-Z0-9_-]*:", line):
            break
        # Blank line or heading → terminate
        if not stripped or stripped.startswith("#"):
            break

        # 2-space indented bullet: primary list item
        if re.match(r"^  - ", line):
            items.append(line[4:].rstrip())
            continue
        # 4+ space indented bullet: sub-detail, fold into last item
        if re.match(r"^    -", line) and items:
            items[-1] = items[-1] + "\n" + line.rstrip()
            continue
        # Continuation text (4+ spaces without bullet): fold into last item
        if line.startswith("    ") and items:
            items[-1] = items[-1] + "\n" + line.rstrip()
            continue

    return items


def _slugify(title: str) -> str:
    """Convert a task title to a kebab-case slug (max 40 chars).

    Returns "" if no valid slug can be produced (caller should use TSK-ID fallback).
    """
    # Lowercase
    slug = title.lower()
    # Replace non-alphanumeric chars with hyphen
    slug = re.sub(r'[^a-z0-9]+', '-', slug)
    # Collapse multiple hyphens
    slug = re.sub(r'-+', '-', slug)
    # Strip leading/trailing hyphens
    slug = slug.strip('-')
    # Truncate to 40 chars, avoiding a trailing hyphen
    if len(slug) > 40:
        slug = slug[:40].rstrip('-')
    return slug


def parse_tasks_from_wp(wp_block: str, pending_only: bool = False) -> list:
    """Parse task entries from a WP block."""
    tasks = []
    current = None

    for line in wp_block.splitlines():
        m = re.match(r'^#{3,4}\s+(TSK-\d+(?:-\d+)+):\s*(.*)', line)
        if m:
            if current is not None:
                status = current.get("status", "")
                category = current.get("category", "")
                if not pending_only or ("[xx]" not in status and category != "feat"):
                    tasks.append(current)
            current = {
                "tsk_id": m.group(1),
                "title": m.group(2).strip(),
                "status": "",
                "depends": "",
                "domain": "",
                "category": "",
            }
            continue
        if current is not None:
            if line.startswith("- status:"):
                current["status"] = line[len("- status:"):].strip()
            elif line.startswith("- depends:"):
                current["depends"] = line[len("- depends:"):].strip()
            elif line.startswith("- domain:"):
                current["domain"] = line[len("- domain:"):].strip()
            elif line.startswith("- category:"):
                current["category"] = line[len("- category:"):].strip()

    if current is not None:
        status = current.get("status", "")
        category = current.get("category", "")
        if not pending_only or ("[xx]" not in status and category != "feat"):
            tasks.append(current)

    return tasks


_DEV_CONFIG_TEMPLATE_FALLBACK = """\
## Dev Config

### Domains
| domain | description | unit-test | e2e-test | e2e-server | e2e-url |
|--------|-------------|-----------|----------|------------|---------|
| backend | Server API | `your-unit-test-cmd` | `your-e2e-test-cmd` | - | - |
| frontend | Client UI | `your-unit-test-cmd` | `your-e2e-test-cmd` | `your-dev-server-cmd` | `http://localhost:3000` |
| database | Data layer | - | - | - | - |
| fullstack | Full stack | - | - | - | - |

### Design Guidance
| domain | architecture |
|--------|-------------|
| backend | Your backend architecture description |
| frontend | Your frontend architecture description |

### Quality Commands
| name | command |
|------|---------|
| lint | `your-lint-cmd` |
| typecheck | `your-typecheck-cmd` |
| coverage | `your-coverage-cmd` |

### Cleanup Processes
node, vitest
"""


def _dev_config_template_body() -> str:
    """Load the canonical Dev Config section from dev-config-template.md.

    Extracts the ```markdown fenced block, falling back to an embedded copy if
    the file is missing or the fence is absent. Keeps the Python template in
    sync with the markdown reference (F08).
    """
    plugin_root = os.environ.get("CLAUDE_PLUGIN_ROOT") or \
        os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    path = os.path.join(plugin_root, "skills", "wbs", "references", "dev-config-template.md")
    try:
        with open(path, "r", encoding="utf-8") as f:
            text = f.read()
    except OSError:
        return _DEV_CONFIG_TEMPLATE_FALLBACK
    # Pull out the first ```markdown fenced block; if absent, use whole file.
    m = re.search(r"```markdown\n(.*?)\n```", text, re.DOTALL)
    if m:
        return m.group(1)
    return _DEV_CONFIG_TEMPLATE_FALLBACK


def _dev_config_missing_message() -> str:
    return (
        "wbs.md에 '## Dev Config' 섹션이 없습니다. 아래 내용을 wbs.md 헤더와 첫 번째 WP 사이에 추가하세요:\n\n"
        + _dev_config_template_body()
    )


def _parse_md_table(lines: list, header_name: str, expected_cols: list) -> list:
    """Parse a markdown table under a ### heading. Handles backtick-wrapped values containing |."""
    in_section = False
    header_found = False
    rows = []

    for line in lines:
        stripped = line.strip()
        # Match ### heading
        if re.match(r'^###\s+' + re.escape(header_name) + r'\s*$', stripped, re.IGNORECASE):
            in_section = True
            header_found = False
            continue
        # Exit on next ### or ## heading
        if in_section and re.match(r'^#{2,3}\s+', stripped) and not re.match(r'^###\s+' + re.escape(header_name), stripped, re.IGNORECASE):
            break
        if not in_section:
            continue

        # Skip empty lines
        if not stripped or not stripped.startswith("|"):
            continue

        # Parse table row — handle backticks containing |
        cells = _split_table_row(stripped)
        if not cells:
            continue

        # Skip header row and separator row
        if not header_found:
            header_found = True
            continue
        if all(c.strip().replace("-", "").replace(":", "") == "" for c in cells):
            continue

        rows.append(cells)

    return rows


def _split_table_row(row: str) -> list:
    """Split a markdown table row, respecting backtick-wrapped content."""
    # Remove leading/trailing |
    row = row.strip()
    if row.startswith("|"):
        row = row[1:]
    if row.endswith("|"):
        row = row[:-1]

    cells = []
    current = []
    in_backtick = False
    for ch in row:
        if ch == '`':
            in_backtick = not in_backtick
            current.append(ch)
        elif ch == '|' and not in_backtick:
            cells.append("".join(current).strip())
            current = []
        else:
            current.append(ch)
    cells.append("".join(current).strip())
    return cells


def _cell_value(cell: str):
    """Convert cell value: strip backticks, '-' → None."""
    cell = cell.strip()
    if cell == "-" or cell == "":
        return None
    # Strip surrounding backticks
    if cell.startswith("`") and cell.endswith("`"):
        cell = cell[1:-1]
    return cell


def parse_dev_config(wbs_text: str) -> dict:
    """Parse ## Dev Config section from WBS text."""
    lines = wbs_text.splitlines()
    start = None
    end = None

    for i, line in enumerate(lines):
        if re.match(r'^##\s+Dev\s+Config\s*$', line, re.IGNORECASE):
            start = i
            continue
        # End at next ## heading (not ###)
        if start is not None and re.match(r'^##\s+', line) and not line.strip().startswith("###"):
            if not re.match(r'^##\s+Dev\s+Config', line, re.IGNORECASE):
                end = i
                break

    if start is None:
        return {"error": "DEV_CONFIG_MISSING", "message": _dev_config_missing_message()}

    section = lines[start:end]

    # Parse Domains table
    domain_rows = _parse_md_table(section, "Domains", ["domain", "description", "unit-test", "e2e-test"])
    domains = {}
    fullstack_domains = []
    for row in domain_rows:
        if len(row) < 4:
            continue
        d = row[0].strip().strip("`")
        unit = _cell_value(row[2])
        e2e = _cell_value(row[3])
        e2e_server = _cell_value(row[4]) if len(row) > 4 else None
        e2e_url = _cell_value(row[5]) if len(row) > 5 else None
        domains[d] = {
            "description": _cell_value(row[1]) or d,
            "unit_test": unit,
            "e2e_test": e2e,
            "e2e_server": e2e_server,
            "e2e_url": e2e_url,
        }
        if d != "fullstack" and (unit or e2e):
            fullstack_domains.append(d)

    # Parse Design Guidance table
    guidance_rows = _parse_md_table(section, "Design Guidance", ["domain", "architecture"])
    design_guidance = {}
    for row in guidance_rows:
        if len(row) < 2:
            continue
        d = row[0].strip().strip("`")
        val = _cell_value(row[1])
        if val:
            design_guidance[d] = val

    # Parse Quality Commands table
    quality_rows = _parse_md_table(section, "Quality Commands", ["name", "command"])
    quality_commands = {}
    for row in quality_rows:
        if len(row) < 2:
            continue
        name = row[0].strip().strip("`")
        val = _cell_value(row[1])
        if val:
            quality_commands[name] = val

    # Parse Cleanup Processes
    cleanup_processes = []
    in_cleanup = False
    for line in section:
        stripped = line.strip()
        if re.match(r'^###\s+Cleanup\s+Processes\s*$', stripped, re.IGNORECASE):
            in_cleanup = True
            continue
        if in_cleanup and re.match(r'^#{2,3}\s+', stripped):
            break
        if in_cleanup and stripped and not stripped.startswith("|") and not stripped.startswith("---"):
            cleanup_processes = [p.strip() for p in stripped.split(",") if p.strip()]
            break

    return {
        "domains": domains,
        "design_guidance": design_guidance,
        "quality_commands": quality_commands,
        "cleanup_processes": cleanup_processes,
        "fullstack_domains": fullstack_domains,
    }


def _read_file(path: str) -> str:
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def _resolve_dev_config_feat(feat_dir: str, docs_dir: str) -> dict:
    """Fallback chain for feat mode: feat-local → wbs → default.

    Returns parsed dev-config JSON with a `source` field indicating origin.
    """
    # 1) Feature-local override: {feat_dir}/dev-config.md
    local_path = os.path.join(feat_dir, "dev-config.md")
    if os.path.isfile(local_path):
        try:
            result = parse_dev_config(_read_file(local_path))
            if "error" not in result:
                result["source"] = "feat-local"
                result["source_path"] = local_path
                return result
        except OSError:
            pass

    # 2) Project wbs.md Dev Config section
    if docs_dir:
        wbs_path = os.path.join(docs_dir, "wbs.md")
        if os.path.isfile(wbs_path):
            try:
                result = parse_dev_config(_read_file(wbs_path))
                if "error" not in result:
                    result["source"] = "wbs"
                    result["source_path"] = wbs_path
                    return result
            except OSError:
                pass

    # 3) Global default
    plugin_root = os.environ.get("CLAUDE_PLUGIN_ROOT") or \
        os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    default_path = os.path.join(plugin_root, "references", "default-dev-config.md")
    if not os.path.isfile(default_path):
        return {
            "error": "DEFAULT_DEV_CONFIG_MISSING",
            "message": f"Default dev-config not found at {default_path}. Plugin installation may be corrupted.",
        }
    try:
        result = parse_dev_config(_read_file(default_path))
        if "error" in result:
            return result
        result["source"] = "default"
        result["source_path"] = default_path
        return result
    except OSError as e:
        return {
            "error": "DEFAULT_DEV_CONFIG_READ_ERROR",
            "message": f"Failed to read {default_path}: {e}",
        }


def _resolve_phase_from_status(status: str, sm: dict) -> str:
    """Resolve start_phase from a status string using the state machine, with fallback.

    Legacy markers [dd!]/[im!] are normalized before DFA lookup:
      [dd!] → [ ]  (design failure = no progress)
      [im!] → [im] (safest default: assume build ok, test failed)
    """
    key = status.strip() if status and status.strip() else "[ ]"
    legacy_map = {"[dd!]": "[ ]", "[im!]": "[im]"}
    key = legacy_map.get(key, key)

    state_def = sm.get("states", {}).get(key) if sm else None
    if state_def:
        return state_def.get("phase_start") or "design"
    # Fallback if state machine missing
    if "[xx]" in key:
        return "done"
    if "[ts]" in key:
        return "refactor"
    if "[im]" in key:
        return "test"
    if "[dd]" in key:
        return "build"
    return "design"


def _load_task_state_json(docs_dir: str, tsk_id: str):
    """Load state.json for a WBS task, if present.

    Returns the parsed dict or None if the file is missing/unreadable.
    """
    path = os.path.join(docs_dir, "tasks", tsk_id, "state.json")
    if not os.path.isfile(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return None


def _enrich_tasks_with_state(tasks: list, docs_dir: str) -> list:
    """Enrich task dicts with state.json data (bypassed flag, accurate status).

    For each task, if state.json exists:
      - Update status from state.json (source of truth)
      - Add bypassed flag if present
    Returns the same list (mutated in place).
    """
    for task in tasks:
        tsk_id = task.get("tsk_id", "")
        if not tsk_id:
            continue
        state_data = _load_task_state_json(docs_dir, tsk_id)
        if state_data is None:
            continue
        # state.json is the source of truth for status
        if "status" in state_data:
            task["status"] = state_data["status"]
        if state_data.get("bypassed"):
            task["bypassed"] = True
            task["bypassed_reason"] = state_data.get("bypassed_reason", "")
    return tasks


def _load_feat_state(feat_dir: str):
    """Load feat state, preferring state.json, falling back to legacy status.json.

    Normalizes the legacy ``state`` field name to ``status``.
    Returns (data, err).
    """
    state_path = os.path.join(feat_dir, "state.json")
    legacy_path = os.path.join(feat_dir, "status.json")
    target = state_path if os.path.isfile(state_path) else legacy_path
    if not os.path.isfile(target):
        return None, f"neither state.json nor status.json found in {feat_dir}"
    try:
        with open(target, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError) as e:
        return None, f"failed to read {target}: {e}"
    if "state" in data and "status" not in data:
        data["status"] = data.pop("state")
    return data, None


def _load_state_machine():
    plugin_root = os.environ.get("CLAUDE_PLUGIN_ROOT")
    if not plugin_root:
        plugin_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    sm_path = os.path.join(plugin_root, "references", "state-machine.json")
    if not os.path.isfile(sm_path):
        return None, f"state-machine.json not found at {sm_path}"
    try:
        with open(sm_path, "r", encoding="utf-8") as f:
            return json.load(f), None
    except (OSError, json.JSONDecodeError) as e:
        return None, f"load error: {e}"


# --- Complexity scoring ---

_COMPLEXITY_KEYWORDS = re.compile(
    r"아키텍처|마이그레이션|인프라|통합|리팩토링|미들웨어|트랜잭션|동시성|상태머신|인증체계"
    r"|architecture|migration|infrastructure|integration|refactor|middleware|transaction|concurrency"
    r"|websocket|fsm|state.machine|oauth|rbac",
    re.IGNORECASE,
)
_METADATA_LINE = re.compile(r"^- (?:category|domain|status|priority|assignee|schedule|tags|depends|model):")
_SIMPLE_CATEGORIES = {"config", "docs", "documentation"}
_SIMPLE_DOMAINS = {"docs", "test"}

COMPLEXITY_THRESHOLD = 3  # >= threshold → opus

_VALID_MODELS = {"opus", "sonnet"}


def _strip_metadata(block: str) -> str:
    """Remove metadata lines from block so keyword search hits content only."""
    return "\n".join(
        line for line in block.splitlines()
        if not _METADATA_LINE.match(line.strip())
    )


def compute_complexity(block: str) -> dict:
    """Score task complexity from WBS block metadata.

    Priority: explicit `- model:` field in WBS > auto scoring.

    Auto scoring (fallback when model field absent):
      depends: 0-1→0, 2-3→+1, 4+→+2
      domain: default/backend→0, frontend→+1, fullstack→+2, docs/test→-1
      keywords in content (excl. metadata): +2
      category: config/docs→-1
    """
    # --- Explicit model field takes priority ---
    explicit_model = get_field(block, "model").strip().lower()
    if explicit_model and explicit_model in _VALID_MODELS:
        return {
            "complexity_score": None,
            "recommended_model": explicit_model,
            "source": "wbs",
            "factors": ["explicit"],
            "threshold": COMPLEXITY_THRESHOLD,
        }

    # --- Fallback: auto scoring ---
    score = 0
    factors = []

    # depends — scaled by count
    depends_raw = get_field(block, "depends").strip()
    if depends_raw and depends_raw != "-":
        dep_list = [d.strip() for d in depends_raw.split(",") if d.strip() and d.strip() != "-"]
        dep_count = len(dep_list)
    else:
        dep_count = 0

    if dep_count >= 4:
        score += 2
        factors.append(f"depends:{dep_count}")
    elif dep_count >= 2:
        score += 1
        factors.append(f"depends:{dep_count}")

    # domain
    domain = get_field(block, "domain").strip().lower()
    if domain in ("frontend",):
        score += 1
        factors.append(f"domain:{domain}")
    elif domain in ("fullstack",):
        score += 2
        factors.append(f"domain:{domain}")
    elif domain in _SIMPLE_DOMAINS:
        score -= 1
        factors.append(f"domain:{domain}(-1)")

    # keywords — search content only, not metadata lines
    content = _strip_metadata(block)
    if _COMPLEXITY_KEYWORDS.search(content):
        score += 2
        factors.append("keyword_match")

    # simple category discount
    category = get_field(block, "category").strip().lower()
    if category in _SIMPLE_CATEGORIES:
        score -= 1
        factors.append(f"category:{category}(-1)")

    score = max(score, 0)
    model = "opus" if score >= COMPLEXITY_THRESHOLD else "sonnet"

    return {
        "complexity_score": score,
        "recommended_model": model,
        "source": "auto",
        "factors": factors,
        "threshold": COMPLEXITY_THRESHOLD,
    }


def _handle_feat_mode(argv):
    """Feature mode dispatcher: wbs-parse.py --feat <feat-dir> <mode> [extra]."""
    if len(argv) < 4:
        print("ERROR: --feat requires <feat-dir> <mode>", file=sys.stderr)
        sys.exit(1)

    feat_dir = argv[2]
    mode = argv[3]

    if not os.path.isdir(feat_dir):
        print(f"ERROR: feature dir not found: {feat_dir}", file=sys.stderr)
        sys.exit(1)

    # --dev-config uses its own fallback chain (no status.json required)
    if mode == "--dev-config":
        docs_dir = argv[4] if len(argv) > 4 else ""
        result = _resolve_dev_config_feat(feat_dir, docs_dir)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return

    data, err = _load_feat_state(feat_dir)
    if err:
        print(f"ERROR: {err}", file=sys.stderr)
        sys.exit(1)

    name = data.get("name") or os.path.basename(feat_dir.rstrip("/"))
    status = data.get("status", "[ ]")

    if mode == "--phase-start":
        sm, sm_err = _load_state_machine()
        phase = _resolve_phase_from_status(status, sm or {})
        result = {
            "source": "feat",
            "feat_name": name,
            "feat_dir": feat_dir,
            "status": status,
            "start_phase": phase,
        }
        if sm_err:
            result["state_machine_warning"] = sm_err
        print(json.dumps(result, ensure_ascii=False))
        return

    if mode == "--status":
        print(json.dumps(data, ensure_ascii=False, indent=2))
        return

    print(f"ERROR: unknown feat mode: {mode}", file=sys.stderr)
    sys.exit(1)


def main():
    # Feature mode short-circuit
    if len(sys.argv) >= 2 and sys.argv[1] == "--feat":
        _handle_feat_mode(sys.argv)
        return

    if len(sys.argv) < 3:
        print(USAGE)
        sys.exit(1)

    wbs_path = sys.argv[1]
    # Accept whole-WBS modes that don't need a target_id (e.g. --tasks-all).
    # Convention so far: argv[2] is a TSK/WP id, or "-" as placeholder for
    # modes like --dev-config. We now also allow argv[2] to be a flag itself.
    if sys.argv[2].startswith("--"):
        target_id = None
        mode = sys.argv[2]
        field_name = sys.argv[3] if mode == "--field" and len(sys.argv) > 3 else None
    else:
        target_id = sys.argv[2]
        mode = sys.argv[3] if len(sys.argv) > 3 else "--json"
        field_name = sys.argv[4] if mode == "--field" and len(sys.argv) > 4 else None

    if mode == "--field" and not field_name:
        print("ERROR: --field requires a field name", file=sys.stderr)
        sys.exit(1)

    if not os.path.isfile(wbs_path):
        print(f"ERROR: file not found: {wbs_path}", file=sys.stderr)
        sys.exit(1)

    with open(wbs_path, "r", encoding="utf-8") as f:
        wbs_text = f.read()

    # -- Raw block --
    if mode == "--block":
        block = extract_task_block(wbs_text, target_id)
        if not block:
            print(f"ERROR: {target_id} not found in {wbs_path}", file=sys.stderr)
            sys.exit(1)
        print(block)

    # -- Single field --
    elif mode == "--field":
        block = extract_task_block(wbs_text, target_id)
        if not block:
            print(f"ERROR: {target_id} not found", file=sys.stderr)
            sys.exit(1)
        print(get_field(block, field_name))

    # -- Task JSON (default) --
    elif mode == "--json":
        block = extract_task_block(wbs_text, target_id)
        if not block:
            print(f"ERROR: {target_id} not found in {wbs_path}", file=sys.stderr)
            sys.exit(1)

        first_line = block.splitlines()[0] if block else ""
        # Remove heading prefix and task ID
        title = re.sub(r'^#{2,4}\s+[^:]*:\s*', '', first_line)

        # Single-line scalar fields
        scalar_fields = [
            "category", "domain", "model", "status", "priority",
            "assignee", "schedule", "tags", "depends", "blocked-by",
            "note", "entry-point", "prd-ref",
        ]
        # Multi-line list fields (support both CSV and bullet-list shapes)
        list_fields = [
            "requirements", "acceptance", "constraints", "test-criteria",
            "tech-spec", "api-spec", "data-model", "ui-spec",
        ]

        result: dict = {"tsk_id": target_id, "title": title}
        for f in scalar_fields:
            # Output JSON keys use underscores to match Python convention downstream.
            key = f.replace("-", "_")
            result[key] = get_field(block, f)
        for f in list_fields:
            key = f.replace("-", "_")
            result[key] = parse_list_field(block, f)
        result["block"] = block
        print(json.dumps(result, ensure_ascii=False, indent=2))

    # -- WP child tasks (all) --
    elif mode == "--tasks":
        wp_block = extract_wp_block(wbs_text, target_id)
        if not wp_block:
            print(f"ERROR: {target_id} not found in {wbs_path}", file=sys.stderr)
            sys.exit(1)
        tasks = parse_tasks_from_wp(wp_block, pending_only=False)
        docs_dir = os.path.dirname(wbs_path)
        _enrich_tasks_with_state(tasks, docs_dir)
        print(json.dumps(tasks, ensure_ascii=False, indent=2))

    # -- All tasks in the whole WBS (flat list, all WPs) --
    elif mode == "--tasks-all":
        all_tasks = []
        docs_dir = os.path.dirname(wbs_path)
        # Split WBS into per-WP blocks and parse each
        wp_headers = list(re.finditer(r'^##\s+(WP-\d+):', wbs_text, re.MULTILINE))
        for idx, m in enumerate(wp_headers):
            start = m.start()
            end = wp_headers[idx + 1].start() if idx + 1 < len(wp_headers) else len(wbs_text)
            wp_block = wbs_text[start:end]
            tasks = parse_tasks_from_wp(wp_block, pending_only=False)
            all_tasks.extend(tasks)
        _enrich_tasks_with_state(all_tasks, docs_dir)
        print(json.dumps(all_tasks, ensure_ascii=False, indent=2))

    # -- WP child tasks (pending only) --
    elif mode == "--tasks-pending":
        wp_block = extract_wp_block(wbs_text, target_id)
        if not wp_block:
            print(f"ERROR: {target_id} not found in {wbs_path}", file=sys.stderr)
            sys.exit(1)
        tasks = parse_tasks_from_wp(wp_block, pending_only=True)
        docs_dir = os.path.dirname(wbs_path)
        _enrich_tasks_with_state(tasks, docs_dir)
        # Exclude bypassed tasks (effectively done for scheduling)
        tasks = [t for t in tasks if not t.get("bypassed")]
        print(json.dumps(tasks, ensure_ascii=False, indent=2))

    # -- feat tasks in a WP (category: feat only) --
    elif mode == "--feat-tasks":
        wp_block = extract_wp_block(wbs_text, target_id)
        if not wp_block:
            print(f"ERROR: {target_id} not found in {wbs_path}", file=sys.stderr)
            sys.exit(1)
        all_tasks = parse_tasks_from_wp(wp_block, pending_only=False)
        feat_tasks = []
        for t in all_tasks:
            if t.get("category") != "feat":
                continue
            tsk_id = t["tsk_id"]
            title = t.get("title", "")
            slug = _slugify(title)
            if slug:
                feat_name = slug
            else:
                # Fallback: lowercase TSK-ID (e.g. TSK-01-02 → tsk-01-02)
                feat_name = tsk_id.lower()
            feat_tasks.append({
                "tsk_id": tsk_id,
                "feat_name": feat_name,
                "title": title,
            })
        print(json.dumps(feat_tasks, ensure_ascii=False, indent=2))

    # -- Resumable WPs --
    elif mode == "--resumable-wps":
        docs_dir = os.path.dirname(wbs_path)
        wps = []
        current_wp = None
        in_task = False
        current_tsk_id = None

        for line in wbs_text.splitlines():
            m = re.match(r'^## (WP-\d+):', line)
            if m:
                if current_wp and current_wp["pending"] > 0:
                    wps.append(current_wp)
                current_wp = {"wp_id": m.group(1), "pending": 0, "total": 0}
                in_task = False
                current_tsk_id = None
                continue
            if current_wp is not None:
                tsk_m = re.match(r'^#{3,4}\s+(TSK-\d+(?:-\d+)+):', line)
                if tsk_m:
                    in_task = True
                    current_tsk_id = tsk_m.group(1)
                    current_wp["total"] += 1
                if in_task and line.startswith("- status:"):
                    if "[xx]" not in line:
                        # Check state.json for bypassed status
                        is_bypassed = False
                        if current_tsk_id:
                            state_data = _load_task_state_json(docs_dir, current_tsk_id)
                            if state_data and state_data.get("bypassed"):
                                is_bypassed = True
                        if not is_bypassed:
                            current_wp["pending"] += 1
                    in_task = False
                    current_tsk_id = None

        if current_wp and current_wp["pending"] > 0:
            wps.append(current_wp)

        print(json.dumps(wps, ensure_ascii=False, indent=2))

    # -- Complexity --
    elif mode == "--complexity":
        block = extract_task_block(wbs_text, target_id)
        if not block:
            print(f"ERROR: {target_id} not found in {wbs_path}", file=sys.stderr)
            sys.exit(1)
        result = compute_complexity(block)
        result["tsk_id"] = target_id
        print(json.dumps(result, ensure_ascii=False, indent=2))

    # -- Dev Config --
    elif mode == "--dev-config":
        result = parse_dev_config(wbs_text)
        print(json.dumps(result, ensure_ascii=False, indent=2))

    # -- Phase start --
    elif mode == "--phase-start":
        block = extract_task_block(wbs_text, target_id)
        if not block:
            print(f"ERROR: {target_id} not found", file=sys.stderr)
            sys.exit(1)

        domain = get_field(block, "domain")
        docs_dir = os.path.dirname(wbs_path)

        # state.json is the source of truth when present; fall back to wbs.md status line.
        state_data = _load_task_state_json(docs_dir, target_id)
        if state_data is not None:
            status = state_data.get("status", "[ ]") or "[ ]"
            status_source = "state.json"
        else:
            status = get_field(block, "status") or "[ ]"
            status_source = "wbs.md"

        sm, sm_error = _load_state_machine()
        phase = _resolve_phase_from_status(status, sm or {})

        result = {
            "tsk_id": target_id,
            "status": status,
            "status_source": status_source,
            "domain": domain,
            "start_phase": phase,
            "docs_dir": docs_dir,
        }
        if state_data and state_data.get("last"):
            result["last"] = state_data["last"]
        if state_data and state_data.get("bypassed"):
            result["bypassed"] = True
            result["bypassed_reason"] = state_data.get("bypassed_reason", "")
        # Drift detection: warn if state.json and wbs.md disagree on status
        if state_data is not None:
            wbs_status = get_field(block, "status") or "[ ]"
            legacy_map = {"[dd!]": "[ ]", "[im!]": "[im]"}
            wbs_norm = legacy_map.get(wbs_status, wbs_status)
            if wbs_norm != status:
                result["drift_warning"] = f"wbs.md status {wbs_status} != state.json status {status}"
        if sm_error:
            result["state_machine_warning"] = sm_error
        print(json.dumps(result, ensure_ascii=False))

    else:
        print(USAGE)
        sys.exit(1)


if __name__ == "__main__":
    main()
