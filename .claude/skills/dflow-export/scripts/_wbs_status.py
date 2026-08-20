"""_wbs_status.py — WBS 상태 어휘 공유 정의.

로컬 사이클은 5상태(`references/state-machine.json`)로 계속 돈다. 이 모듈은
① 로컬 표기를 D'Flow `stage` 코드로 번역하는 매핑표(export 계약 §7.2-2)와
② 프로젝트 상태머신 해석(dep 충족 임계)을 제공한다. 로컬 상태머신 자체는 바꾸지 않는다.
"""
from __future__ import annotations

import json
import os

# --- 어휘 ---------------------------------------------------------------

# 로컬 사이클 어휘 (플러그인 references/state-machine.json)
V5_STATES = ("[ ]", "[dd]", "[im]", "[ts]", "[xx]")

# D'Flow stage 축 (dev-workflow docs/state-machine.json — 서버가 소유)
V6_STATES = ("[ ]", "[as]", "[fp]", "[ip]", "[im]", "[xx]")

# 6상태에만 존재하는 코드. 어휘 판별의 유일한 지표.
V6_ONLY = ("[as]", "[fp]", "[ip]")

# 파일 표기 → D'Flow stage 코드.
# [dd]/[ts] 는 사이클 내부 단계라 D'Flow 에 대응 상태가 없다 — 둘 다 진행 중(ip).
# v2.1: "[ ]"(진행 없음)는 문자열 "todo" 대신 None(JSON null) 으로 표현한다 —
# stage 어휘가 as|fp|ip|im|xx|null 로 좁혀졌다 (wbs-web 계약, 7cd3b5e 확정).
STAGE_CODE = {
    "[ ]": None, "[as]": "as", "[fp]": "fp",
    "[ip]": "ip", "[im]": "im", "[xx]": "xx",
    "[dd]": "ip", "[ts]": "ip", "[dd!]": "todo", "[im!]": "ip",
}


# --- 판별 ---------------------------------------------------------------

def is_v6_states(states) -> bool:
    """상태 코드 집합이 6상태 어휘인지."""
    if not states:
        return False
    return any(code in states for code in V6_ONLY)


def is_v6_sm(sm) -> bool:
    return is_v6_states(set((sm or {}).get("states", {}).keys()))


def known_states(sm) -> set:
    return set((sm or {}).get("states", {}).keys())


def stage_code(status):
    """파일 표기 → D'Flow stage 코드. 모르는 표기는 None (지어내지 않는다)."""
    return STAGE_CODE.get((status or "").strip())


# --- 의존 충족 -----------------------------------------------------------

def satisfied_states(sm) -> set:
    """의존 충족으로 인정하는 상태 집합.

    6상태 정의에서는 사람 검수([xx]) 대기가 병렬 진행을 막지 않도록 [im] 부터 충족.
    5상태 정의(플러그인 기본)에서는 현행대로 [xx] 만.
    """
    explicit = ((sm or {}).get("dependency") or {}).get("satisfied_states")
    if isinstance(explicit, list) and explicit:
        return set(explicit)
    return {"[im]", "[xx]"} if is_v6_sm(sm) else {"[xx]"}


# --- 상태머신 해석 -------------------------------------------------------

def state_machine_candidates(docs_dir=None) -> list:
    """해석 후보 경로를 우선순위 순으로 반환."""
    out = []
    env = os.environ.get("WBS_STATE_MACHINE")
    if env:
        out.append(env)
    if docs_dir is not None:
        base = os.path.abspath(docs_dir or ".")
        out.append(os.path.join(base, "state-machine.json"))
        # docs/<모듈>/wbs.md 레이아웃 — 한 단계 위까지만 본다
        out.append(os.path.join(os.path.dirname(base), "state-machine.json"))
    plugin_root = os.environ.get("CLAUDE_PLUGIN_ROOT") or \
        os.path.dirname(os.path.abspath(__file__))
    out.append(os.path.join(plugin_root, "references", "state-machine.json"))
    return out


def resolve_state_machine(docs_dir=None):
    """(sm, path, err) 반환. 첫 번째로 존재하는 후보를 쓴다."""
    tried = []
    for path in state_machine_candidates(docs_dir):
        tried.append(path)
        if not os.path.isfile(path):
            continue
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f), path, None
        except (OSError, json.JSONDecodeError) as e:
            return None, path, f"failed to load {path}: {e}"
    return None, None, "state-machine.json not found (tried: " + ", ".join(tried) + ")"
