"""_wbs_md.py — shared Markdown fence-awareness helpers for the WBS toolchain.

wbs-validate.py, merge-wbs-status.py, wbs-parse.py 모두 wbs.md 를 파싱할 때
펜스 코드 블록(``` 또는 ~~~) 내부의 `#`으로 시작하는 줄을 진짜 헤딩과 구별해야
한다 — 그러지 않으면 Task 본문에 예시로 들어간 ```markdown 펜스 안의
`## WP-99:` / `### ACT-99-01:` 같은 줄이 phantom 노드를 만들거나(과다 탐지)
실제 블록 경계를 조기에 끊어(silent undercount) 데이터가 조용히 사라진다.

이 모듈은 그 판단에 쓰는 순수 함수만 담는다(stdlib only). 각 소비자는 이
모듈에서 import 해서 쓰고, 동작이 달라지면 안 되는 기존 로직은 그대로
둔다 — 여기 있는 건 기존에 wbs-validate.py 에서 검증된 정책의 추출본이다.
"""
from __future__ import annotations

import re

# 펜스 코드 블록 시작/끝 줄(```` 또는 ~~~~, 리스트 항목 아래 들여쓴 펜스 포함
# 최대 3칸까지 CommonMark 허용). 펜스 내부의 `# ...` 줄(셸 주석 등)은 헤딩이
# 아니다 — 블록 경계 계산에서 제외해야 한다.
FENCE_RE = re.compile(r"^[ ]{0,3}(?:`{3,}|~{3,})", re.MULTILINE)


def _fenced_ranges(content: str) -> list[tuple[int, int]]:
    """펜스 코드 구간의 (start, end) 오프셋 목록. 여는/닫는 펜스 줄을 순서대로 짝짓는다.

    닫는 펜스가 없는 경우(짝이 없는 마지막 펜스, 실수로 안 닫은 경우 등) 그 뒤를
    통째로 '펜스 안'으로 간주하지 않는다 — 그렇게 하면 그 뒤에 오는 진짜 Task
    헤딩까지 탐지에서 사라져(silent undercount) Task 4 가 고치려던 결함군(과소
    탐지 + ok:true)을 재도입하게 된다. 의심스러우면 펜스로 취급하지 않는 쪽을
    택해 Task 를 잃지 않는다.
    """
    positions = [m.start() for m in FENCE_RE.finditer(content)]
    ranges: list[tuple[int, int]] = []
    it = iter(positions)
    for start in it:
        end = next(it, None)
        if end is None:
            break  # 짝 없는 마지막 펜스 — 구간으로 만들지 않는다
        ranges.append((start, end))
    return ranges


def _in_ranges(pos: int, ranges: list[tuple[int, int]]) -> bool:
    return any(start <= pos < end for start, end in ranges)


def line_start_offsets(content: str) -> list[int]:
    """각 줄의 시작 문자 오프셋 목록 (``str.splitlines()`` 와 인덱스 대응).

    ``_fenced_ranges``/``_in_ranges`` 는 문자 오프셋 기준이지만, 줄 단위로
    스캔하는 소비자(예: wbs-parse.py 의 ``parse_nodes``/``extract_task_block``)
    는 줄 번호만 갖고 있다. ``content.splitlines()``의 각 인덱스에 대응하는
    시작 오프셋을 돌려주어, 그 줄이 펜스 안인지 ``_in_ranges(offsets[i], ranges)``
    로 바로 물을 수 있게 한다.
    """
    offsets: list[int] = []
    pos = 0
    for line in content.splitlines(keepends=True):
        offsets.append(pos)
        pos += len(line)
    return offsets
