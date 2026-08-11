#!/usr/bin/env python3
"""dep-analysis.py — Task dependency level calculation (topological sort).

Replaces dep-analysis.sh for cross-platform support.
Output format is identical JSON.

Modes:
  default        : topological sort → execution levels (backward compatible)
  --graph-stats  : dependency graph health metrics (max chain depth, fan-in,
                   diamond patterns, review candidates for contract extraction,
                   fan_out per task, critical_path, bottleneck_ids)
"""
import heapq
import sys
import os
import json
import re

USAGE = """\
Usage: dep-analysis.py [input-file] [--graph-stats]

Input: JSON array (stdin or file), each element:
  {"tsk_id":"TSK-01-01", "depends":"-", "status":"[ ]"}
  Also accepts "id" as alias for "tsk_id" (e.g. agent-pool format)

  - depends: "-", "(none)", "" -> no dependency
  - depends: "TSK-01-01" or "TSK-01-01, TSK-01-02" -> comma separated
  - status "[xx]" tasks are treated as completed
  - "bypassed": true tasks are treated as completed (dependency satisfied)

Default output: JSON with execution levels
  {
    "levels": {
      "0": ["TSK-01-01", "TSK-01-03"],
      "1": ["TSK-01-02"],
      "2": ["TSK-01-04"]
    },
    "completed": ["TSK-01-00"],
    "circular": [],
    "total": 4,
    "pending": 3
  }

--graph-stats output: JSON with dependency graph health metrics
  {
    "max_chain_depth": 3,
    "total": 12,
    "fan_in_top": [{"tsk_id": "TSK-00-01", "count": 8}, ...],
    "fan_in_ge_3_count": 2,
    "diamond_patterns": [{"apex": "TSK-00-01", "branches": ["TSK-01-01", "TSK-01-02"], "merge": "TSK-02-01"}],
    "diamond_count": 1,
    "review_candidates": [
      {"tsk_id": "TSK-02-03", "reason": "depends>=4", "signal": {"depends_count": 5}},
      {"tsk_id": "TSK-00-01", "reason": "fan_in>=3", "signal": {"fan_in": 8}}
    ]
  }

Examples:
  wbs-parse.py docs/wbs.md WP-01 --tasks-pending | python3 dep-analysis.py
  wbs-parse.py docs/wbs.md --tasks-all | python3 dep-analysis.py --graph-stats
  python3 dep-analysis.py /tmp/tasks.json --graph-stats
"""


def parse_depends(dep_str):
    """Parse a depends string into a list of task IDs."""
    if not dep_str or dep_str in ("-", "(none)"):
        return []
    out = []
    for part in re.split(r'[,\s]+', dep_str):
        part = part.strip()
        if part and part != "-":
            out.append(part)
    return out


def _chain_depth(t, dep_map, memo, stack):
    """Recursively compute the longest dependency chain length ending at t.

    Args:
        t: task id to compute depth for
        dep_map: dict mapping tsk_id -> list of dependency ids
        memo: shared memoization dict (tsk_id -> int)
        stack: set of currently active nodes (cycle guard)

    Returns:
        int: depth of longest chain ending at t (inclusive)
    """
    if t in memo:
        return memo[t]
    if t in stack:
        return 0  # circular guard
    stack.add(t)
    deps = dep_map.get(t, [])
    if not deps:
        d = 1
    else:
        d = 1 + max((_chain_depth(x, dep_map, memo, stack) for x in deps if x in dep_map), default=0)
    stack.discard(t)
    memo[t] = d
    return d


def _compute_fan_out(dep_map, task_ids):
    """Compute fan-out for each task.

    fan_out[t] = number of tasks that list t as a dependency
    (i.e., how many tasks t "feeds" — its direct successors in execution order).

    Args:
        dep_map: dict mapping tsk_id -> list of dependency ids
        task_ids: list of all known tsk_ids in the graph

    Returns:
        dict mapping tsk_id -> int (0 if no successors)
    """
    fan_out = {t: 0 for t in task_ids}
    for t, deps in dep_map.items():
        for d in deps:
            if d in fan_out:
                fan_out[d] += 1
    return fan_out


def _compute_critical_path(dep_map, task_ids):
    """Compute the critical (longest) path from a root to a leaf via DP.

    Uses Kahn's algorithm (topological BFS) + longest-path DP.
    Tiebreak: alphabetically smaller task_id wins (both for parent selection
    and endpoint selection).

    Graph direction convention:
        dep_map[t] = list of tasks that t depends on.
        Execution order: dependency runs first → t runs after.
        So edge direction in execution graph: dependency → t.
        critical_path.edges[i] = {"source": nodes[i], "target": nodes[i+1]}
        means nodes[i] executes before nodes[i+1].

    Args:
        dep_map: dict mapping tsk_id -> list of dependency ids
        task_ids: list of all known tsk_ids in the graph

    Returns:
        dict {"nodes": [...], "edges": [...]}

    Raises:
        ValueError: if a cycle is detected
    """
    if not task_ids:
        return {"nodes": [], "edges": []}

    task_set = set(task_ids)

    # Build in-degree (fan-in) and successor map (execution direction)
    # successors[t] = tasks that depend on t (t runs before them)
    in_degree = {t: 0 for t in task_ids}
    successors = {t: [] for t in task_ids}
    for t in task_ids:
        for d in dep_map.get(t, []):
            if d in task_set:
                in_degree[t] += 1
                successors[d].append(t)

    # Kahn's algorithm: process nodes in topological order.
    # Use a min-heap for O(log n) deterministic (alphabetical) ordering.
    heap = list(sorted(t for t in task_ids if in_degree[t] == 0))
    heapq.heapify(heap)

    # DP: dist[t] = longest chain length ending at t (inclusive)
    # parent[t] = predecessor in the longest path to t
    dist = {t: 1 for t in task_ids}
    parent = {t: None for t in task_ids}

    processed = []
    while heap:
        node = heapq.heappop(heap)
        processed.append(node)

        for succ in successors[node]:
            new_dist = dist[node] + 1
            # Update if longer, or equal dist with alphabetically smaller parent
            if new_dist > dist[succ] or (
                new_dist == dist[succ] and (parent[succ] is None or node < parent[succ])
            ):
                dist[succ] = new_dist
                parent[succ] = node

            in_degree[succ] -= 1
            if in_degree[succ] == 0:
                heapq.heappush(heap, succ)

    if len(processed) != len(task_ids):
        raise ValueError("cycle detected in dependency graph")

    # Find endpoint: node with max dist, tiebreak alphabetical
    max_dist = max(dist.values())
    candidates = sorted(t for t in task_ids if dist[t] == max_dist)
    endpoint = candidates[0]

    # Trace back via parent pointers
    path = []
    cur = endpoint
    while cur is not None:
        path.append(cur)
        cur = parent[cur]
    path.reverse()

    edges = [{"source": path[i], "target": path[i + 1]} for i in range(len(path) - 1)]
    return {"nodes": path, "edges": edges}


def compute_graph_stats(items, fan_in_threshold=3, depends_threshold=4, top_n=5):
    """Compute dependency graph health metrics.

    Returns dict with max_chain_depth, fan_in_top, diamond_patterns,
    review_candidates, fan_out, critical_path, bottleneck_ids.
    """
    dep_map = {}
    task_ids = []
    for item in items:
        tsk_id = item.get("tsk_id", "") or item.get("id", "")
        if not tsk_id:
            continue
        dep_map[tsk_id] = parse_depends(item.get("depends", ""))
        task_ids.append(tsk_id)

    # Fan-in: how many tasks depend on each task
    fan_in = {t: 0 for t in task_ids}
    for t, deps in dep_map.items():
        for d in deps:
            if d in fan_in:
                fan_in[d] += 1
    fan_in_sorted = sorted(fan_in.items(), key=lambda x: (-x[1], x[0]))
    fan_in_top = [{"tsk_id": t, "count": c} for t, c in fan_in_sorted[:top_n] if c > 0]
    fan_in_ge_3_count = sum(1 for _, c in fan_in.items() if c >= fan_in_threshold)

    # Max chain depth via memoized DFS (depth including self)
    memo: dict = {}
    max_chain_depth = max(
        (_chain_depth(t, dep_map, memo, set()) for t in task_ids),
        default=0,
    )

    # Diamond patterns: apex X has 2+ direct children A,B that share a merge M
    children = {t: [] for t in task_ids}
    for t, deps in dep_map.items():
        for d in deps:
            if d in children:
                children[d].append(t)

    diamond_patterns = []
    seen = set()
    for apex, kids in children.items():
        if len(kids) < 2:
            continue
        for i in range(len(kids)):
            for j in range(i + 1, len(kids)):
                a, b = kids[i], kids[j]
                merges = set(children.get(a, [])) & set(children.get(b, []))
                for m in merges:
                    key = (apex, tuple(sorted([a, b])), m)
                    if key in seen:
                        continue
                    seen.add(key)
                    diamond_patterns.append({
                        "apex": apex,
                        "branches": sorted([a, b]),
                        "merge": m,
                    })

    # Review candidates: depends>=threshold or fan_in>=threshold
    candidates = {}
    for t, deps in dep_map.items():
        if len(deps) >= depends_threshold:
            candidates[t] = {
                "tsk_id": t,
                "reason": f"depends>={depends_threshold}",
                "signal": {"depends_count": len(deps)},
            }
    for t, c in fan_in.items():
        if c >= fan_in_threshold:
            if t in candidates:
                candidates[t]["signal"]["fan_in"] = c
                candidates[t]["reason"] += f",fan_in>={fan_in_threshold}"
            else:
                candidates[t] = {
                    "tsk_id": t,
                    "reason": f"fan_in>={fan_in_threshold}",
                    "signal": {"fan_in": c},
                }
    review_candidates = sorted(candidates.values(), key=lambda x: x["tsk_id"])

    # Fan-out: how many tasks each task feeds (number of direct successors)
    fan_out = _compute_fan_out(dep_map, task_ids)

    # Critical path: longest path from root to leaf via DP
    critical_path = _compute_critical_path(dep_map, task_ids)

    # Bottleneck IDs: fan_in >= threshold OR fan_out >= threshold.
    # Both fan-in and fan-out use the same threshold value (fan_in_threshold).
    bottleneck_threshold = fan_in_threshold
    bottleneck_ids = sorted(
        t for t in task_ids
        if fan_in.get(t, 0) >= bottleneck_threshold or fan_out.get(t, 0) >= bottleneck_threshold
    )

    return {
        "max_chain_depth": max_chain_depth,
        "total": len(task_ids),
        "fan_in_top": fan_in_top,
        "fan_in_ge_3_count": fan_in_ge_3_count,
        "diamond_patterns": diamond_patterns,
        "diamond_count": len(diamond_patterns),
        "review_candidates": review_candidates,
        "fan_out": fan_out,
        "fan_out_map": fan_out,  # alias: monitor-server.py _build_graph_payload 호환
        "critical_path": critical_path,
        "bottleneck_ids": bottleneck_ids,
    }


def main():
    # Parse flags
    args = list(sys.argv[1:])
    graph_stats_mode = False
    if "--graph-stats" in args:
        graph_stats_mode = True
        args = [a for a in args if a != "--graph-stats"]

    # Read input
    if args and args[0] != "-":
        input_path = args[0]
        if not os.path.isfile(input_path):
            print(f"ERROR: file not found: {input_path}", file=sys.stderr)
            sys.exit(1)
        with open(input_path, "r", encoding="utf-8") as f:
            raw = f.read()
    else:
        raw = sys.stdin.read()

    raw = raw.strip()
    if not raw:
        if graph_stats_mode:
            print(json.dumps({
                "max_chain_depth": 0,
                "total": 0,
                "fan_in_top": [],
                "fan_in_ge_3_count": 0,
                "diamond_patterns": [],
                "diamond_count": 0,
                "review_candidates": [],
                "fan_out": {},
                "fan_out_map": {},  # alias for monitor-server.py compatibility
                "critical_path": {"nodes": [], "edges": []},
                "bottleneck_ids": [],
            }, ensure_ascii=False, indent=2))
        else:
            print(json.dumps({"levels": {}, "completed": [], "circular": [], "total": 0, "pending": 0}))
        sys.exit(0)

    try:
        items = json.loads(raw)
    except json.JSONDecodeError as e:
        print(f"ERROR: invalid JSON: {e}", file=sys.stderr)
        sys.exit(1)

    if graph_stats_mode:
        try:
            result = compute_graph_stats(items)
        except ValueError as e:
            print(f"ERROR: {e}", file=sys.stderr)
            sys.exit(1)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        sys.exit(0)

    completed = []
    is_completed = set()
    tasks = []  # ordered list of pending task IDs
    task_exists = set()
    dep_map = {}  # tsk_id -> list of dependency IDs

    for item in items:
        tsk_id = item.get("tsk_id", "") or item.get("id", "")
        status = item.get("status", "")
        dep_str = item.get("depends", "")

        category = item.get("category", "")
        if "[xx]" in status or item.get("bypassed") or category == "feat":
            completed.append(tsk_id)
            is_completed.add(tsk_id)
            continue

        tasks.append(tsk_id)
        task_exists.add(tsk_id)

        # Parse depends
        if not dep_str or dep_str in ("-", "(none)"):
            dep_map[tsk_id] = []
        else:
            deps = []
            for part in re.split(r'[,\s]+', dep_str):
                part = part.strip()
                if part and part != "-":
                    deps.append(part)
            dep_map[tsk_id] = deps

    # Topological sort — level assignment
    levels = {}
    level_assigned = set()
    assigned = 0
    max_iter = len(tasks) + 1
    current_level = 0
    circular = []

    while assigned < len(tasks) and current_level < max_iter:
        level_tasks = []

        for t in tasks:
            if t in level_assigned:
                continue

            # Check all dependencies met
            all_met = True
            for dep in dep_map.get(t, []):
                if dep in is_completed:
                    continue
                if dep in level_assigned:
                    continue
                if dep not in task_exists:
                    continue  # external dependency — assume satisfied
                all_met = False
                break

            if all_met:
                level_tasks.append(t)

        if not level_tasks and assigned < len(tasks):
            # Circular dependency detected
            for t in tasks:
                if t not in level_assigned:
                    circular.append(t)
                    level_assigned.add(t)
                    assigned += 1
            break

        levels[str(current_level)] = level_tasks
        for t in level_tasks:
            level_assigned.add(t)
            assigned += 1

        current_level += 1

    result = {
        "levels": levels,
        "completed": completed,
        "circular": circular,
        "total": len(tasks) + len(completed),
        "pending": len(tasks),
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
