"""코드로 찍는 소품(프롭). 생성 이미지에 넣지 않고 여기서 그린다(정리본 §4-4).

각 소품은 ASCII 픽셀 맵이다. 글자 → 색 키, '.' 은 투명. 변형(variant)은 프레임에 따라 바뀌는 모양이다.
색 키: o 외곽선, w 흰색, g 밝은 회색, d 어두운 회색, b 커피, l 물방울 파랑, k 초록, r 빨강, y 노랑,
       s 나무(막대), t 짚(빗자루), m 마커(파랑), n 마커(빨강), e 종이 선.
"""
from typing import Dict, List, Optional

from PIL import Image

PALETTE: Dict[str, tuple] = {
    "o": (26, 20, 32, 255),
    "w": (245, 246, 250, 255),
    "g": (200, 206, 216, 255),
    "d": (110, 116, 130, 255),
    "b": (94, 58, 36, 255),
    "l": (110, 190, 240, 255),
    "k": (70, 190, 110, 255),
    "r": (220, 80, 80, 255),
    "y": (245, 200, 80, 255),
    "s": (150, 104, 60, 255),
    "t": (214, 178, 96, 255),
    "m": (60, 110, 200, 255),
    "n": (210, 70, 70, 255),
    "e": (150, 156, 170, 255),
    "z": (232, 236, 244, 255),
}

CUP = [
    ".oooooo...",
    "owwwwwwo..",
    "owbbbbwooo",
    "owbbbbwo.o",
    "owbbbbwo.o",
    "owbbbbwooo",
    "owwwwwwo..",
    ".oooooo...",
]
STEAM = [
    [],
    [
        "...z....",
        "..z.....",
        "...z....",
    ],
    [
        "..z...z.",
        "...z.z..",
        "..z...z.",
        "...z.z..",
    ],
    [
        "...z....",
        "..z..z..",
        "...z..z.",
        "..z..z..",
        "...z....",
    ],
]
Z_SMALL = ["ooo", "..o", ".o.", "o..", "ooo"]
Z_MID = ["zzzzz", "....z", "...z.", "..z..", ".z...", "zzzzz"]
Z_BIG = ["zzzzzzz", ".....z.", "....z..", "...z...", "..z....", ".z.....", "zzzzzzz"]
PAPERS = [
    "oooooooooooooo",
    "owwwwwwwwwwwwo",
    "oweeeeeeeewwwo",
    "owwwwwwwwwwwwo",
    "oweeeeeeeeeewo",
    "owwwwwwwwwwwwo",
    "oweeeeeeewwwwo",
    "owwwwwwwwwwwwo",
    "oweeeeeeeeewwo",
    "owwwwwwwwwwwwo",
    "oooooooooooooo",
]
PAPERS_FLIP = [
    "oooooooooooooo",
    "owwwwwwwwwwwwo",
    "owwwwwwwwwwwwo",
    "oweeeeeeeeeewo",
    "owwwwwwwwwwwwo",
    "oweeeeeeewwwwo",
    "owwwwwwwwwwwwo",
    "oweeeeeeeeeewo",
    "owwwwwwwwwwwwo",
    "oweeeeeewwwwwo",
    "oooooooooooooo",
]
SWEAT = [
    "..l..",
    ".lll.",
    ".lwl.",
    "lllll",
    ".lll.",
]
MAGNIFIER = [
    "..oooo.....",
    ".ogwwwgo...",
    "ogwwwwwgo..",
    "ogwwwwwwo..",
    "ogwwwwwgo..",
    ".ogwwwgo...",
    "..oooooo...",
    "......osso.",
    ".......osso",
    "........oo.",
]
CHECK = [
    ".......kk",
    "......kk.",
    ".....kk..",
    "kk..kk...",
    ".kkkk....",
    "..kk.....",
]
BROOM = [
    "..........oo",
    ".........oso",
    "........oso.",
    ".......oso..",
    "......oso...",
    ".....oso....",
    "....oso.....",
    "...oso......",
    "..oso.......",
    ".otto.......",
    "otttto......",
    "otttto......",
    "otttto......",
    "oo.oo.......",
]
DUST = [
    ".gg.gg.",
    "gggggg.",
    ".gg.gg.",
]
BOARD = [
    "oooooooooooooooooooooo",
    "owwwwwwwwwwwwwwwwwwwwo",
    "owwwwwwwwwwwwwwwwwwwwo",
    "owwwwwwwwwwwwwwwwwwwwo",
    "owwwwwwwwwwwwwwwwwwwwo",
    "owwwwwwwwwwwwwwwwwwwwo",
    "owwwwwwwwwwwwwwwwwwwwo",
    "owwwwwwwwwwwwwwwwwwwwo",
    "owwwwwwwwwwwwwwwwwwwwo",
    "owwwwwwwwwwwwwwwwwwwwo",
    "owwwwwwwwwwwwwwwwwwwwo",
    "owwwwwwwwwwwwwwwwwwwwo",
    "owwwwwwwwwwwwwwwwwwwwo",
    "oooooooooooooooooooooo",
    "..........oo..........",
    "..........oo..........",
    "........oooooo........",
]
# 화이트보드 위에 그려지는 획. variant 가 커질수록 누적된다.
BOARD_STROKES = [
    [],
    [(3, 3, 9, 3, "m"), (3, 5, 12, 5, "m")],
    [(3, 3, 9, 3, "m"), (3, 5, 12, 5, "m"), (3, 8, 14, 8, "n"), (3, 10, 8, 10, "m")],
    [(3, 3, 9, 3, "m"), (3, 5, 12, 5, "m"), (3, 8, 14, 8, "n"), (3, 10, 8, 10, "m"), (12, 10, 18, 10, "k"), (12, 12, 16, 12, "k")],
]
MARKER = ["mm", "oo"]
QUESTION = [
    ".yyy.",
    "y...y",
    "....y",
    "...y.",
    "..y..",
    ".....",
    "..y..",
]
SCREEN_OFF = None  # 자리표시. 화면 끄기는 animate.py 의 fill 연산으로 한다.


def _img(rows: List[str]) -> Image.Image:
    h = len(rows)
    w = max((len(r) for r in rows), default=0)
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    px = im.load()
    for y, r in enumerate(rows):
        for x, ch in enumerate(r):
            if ch != ".":
                px[x, y] = PALETTE[ch]
    return im


def cup(variant: int = 0) -> Image.Image:
    """머그. variant 0~3 = 김 없음 / 김 3단계. 크기는 항상 10×13, 머그 본체는 y 5~12 에 고정."""
    body = _img(CUP)
    out = Image.new("RGBA", (10, 13), (0, 0, 0, 0))
    if variant:
        steam = _img(STEAM[min(variant, 3)])
        out.paste(steam, (0, 5 - steam.height), steam)
    out.paste(body, (0, 5), body)
    return out


def zzz(variant: int = 1) -> Image.Image:
    """졸음 zzz. variant 1~3 = 작은 z / +중간 z / +큰 Z. 오른쪽 위로 올라간다."""
    out = Image.new("RGBA", (20, 20), (0, 0, 0, 0))
    z1 = _img(Z_SMALL)
    out.paste(z1, (0, 15), z1)
    if variant >= 2:
        z2 = _img(Z_MID)
        out.paste(z2, (5, 8), z2)
    if variant >= 3:
        z3 = _img(Z_BIG)
        out.paste(z3, (12, 0), z3)
    return out


def papers(variant: int = 0) -> Image.Image:
    return _img(PAPERS_FLIP if variant % 2 else PAPERS)


def sweat(variant: int = 0) -> Image.Image:
    """땀방울. variant 는 아래로 떨어지는 단계(0~2) — 위치는 호출자가 옮긴다."""
    return _img(SWEAT)


MAGNIFIER_DOWN = [
    "........oo.",
    ".......osso",
    "......osso.",
    "..oooooo...",
    ".ogwwwgo...",
    "ogwwwwwgo..",
    "ogwwwwwwo..",
    "ogwwwwwgo..",
    ".ogwwwgo...",
    "..oooo.....",
]


def magnifier(variant: int = 0) -> Image.Image:
    """variant 0: 손잡이 아래(렌즈가 손 위쪽). variant 1: 손잡이 위(렌즈가 손 아래쪽, 책상 위를 들여다봄)."""
    return _img(MAGNIFIER_DOWN if variant else MAGNIFIER)


def check(variant: int = 0) -> Image.Image:
    return _img(CHECK)


def broom(variant: int = 0) -> Image.Image:
    return _img(BROOM)


def dust(variant: int = 0) -> Image.Image:
    return _img(DUST)


def board(variant: int = 0) -> Image.Image:
    im = _img(BOARD)
    px = im.load()
    for x0, y0, x1, y1, c in BOARD_STROKES[min(variant, 3)]:
        for x in range(x0, x1 + 1):
            for y in range(y0, y1 + 1):
                px[x, y] = PALETTE[c]
    return im


def marker(variant: int = 0) -> Image.Image:
    return _img(MARKER)


def question(variant: int = 0) -> Image.Image:
    return _img(QUESTION)


def empty_desk(variant: int = 0) -> Image.Image:
    """공용 빈자리(READY/OFFLINE/DONE). 96×96, 의자 등받이 + 책상 + 키보드 + 마우스 + 꺼진 모니터."""
    im = Image.new("RGBA", (96, 96), (0, 0, 0, 0))
    px = im.load()

    def rect(x0, y0, x1, y1, c, outline=True):
        for x in range(x0, x1):
            for y in range(y0, y1):
                px[x, y] = PALETTE[c]
        if outline:
            for x in range(x0, x1):
                px[x, y0] = PALETTE["o"]
                px[x, y1 - 1] = PALETTE["o"]
            for y in range(y0, y1):
                px[x0, y] = PALETTE["o"]
                px[x1 - 1, y] = PALETTE["o"]

    rect(30, 40, 66, 82, "d")           # 의자 등받이
    rect(33, 43, 63, 79, "e", False)    # 등받이 안쪽
    rect(6, 22, 34, 52, "d")            # 모니터(꺼짐)
    rect(9, 25, 31, 47, "o", False)
    rect(17, 52, 23, 58, "d")           # 모니터 받침
    rect(12, 58, 28, 60, "d")
    rect(4, 78, 92, 96, "g")            # 책상 상판
    rect(4, 88, 92, 96, "d")            # 책상 앞면
    rect(34, 80, 70, 88, "e")           # 키보드
    for x in range(36, 68, 3):
        for y in (82, 85):
            px[x, y] = PALETTE["d"]
    rect(76, 81, 84, 87, "g")           # 마우스
    return im


PROPS = {
    "cup": cup, "zzz": zzz, "papers": papers, "sweat": sweat, "magnifier": magnifier, "check": check,
    "broom": broom, "dust": dust, "board": board, "marker": marker, "question": question, "empty_desk": empty_desk,
}


def draw(name: str, variant: int = 0) -> Image.Image:
    return PROPS[name](variant)
