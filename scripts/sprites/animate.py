#!/usr/bin/env python3
"""기준 그림 1장 + 캐릭터 정의(character.json) + 공용 조합표(animations.json)로 상태별 프레임 시트를 굽는다.

    python3 scripts/sprites/animate.py assets/sprites/<char> public/sprites/<char> [--anims assets/sprites/animations.json]
                                       [--gif <dir>] [--only typing,stale]
    python3 scripts/sprites/animate.py --empty public/sprites/empty.png      # 공용 빈자리 1프레임

프레임은 매번 기준 그림에서 시작해 연산 목록을 순서대로 적용한 결과다(누적 없음). 회전·확대는 없다.
연산:
  ["move",  part, dx, dy]                 파츠 사각형을 옮긴다. 빈 자리는 parts[part].fill 규칙으로 채운다.
  ["raise", part, dx, dy, shoulder]       move + 어깨 앵커에서 손까지 소매 막대를 그린다(손 아래).
  ["blink", part?...]                     눈 파츠의 눈 색을 바탕색으로 지우고 감은 눈 선을 긋는다. 생략하면 eye_* 전부.
  ["prop",  name, at, dx, dy, variant]    소품을 앵커(또는 파츠의 현재 원점) + 오프셋에 찍는다.
  ["fill",  part, "#rrggbb"]              파츠 사각형을 단색으로 채운다(화면 끄기 등).
character.json:
  { "base": "base.png", "cell": [96, 96],
    "parts":   { "head": {"rect": [x0,y0,x1,y1], "fill": "row" | "col" | ["shift", dx]}, ... },
    "anchors": { "shoulder_l": [x, y], "cup": [x, y], ... },
    "colors":  { "eye": ["#hex", ...], "eye_bg": "#hex"(감은 눈 바탕, 생략 시 사각형 안 최빈 비-눈 색), "lid": "#hex",
                 "sleeve": "#hex", "sleeve_shade": "#hex", "outline": "#hex" } }
출력: <out>/<anim>.png(가로 스트립) + <out>/manifest.json({cell, anims:{name:{frames,fps}}}).
"""
import argparse
import json
import pathlib
import sys
from collections import Counter
from typing import Dict, List, Optional, Tuple

from PIL import Image, ImageChops

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import props  # noqa: E402

Rect = Tuple[int, int, int, int]


def hex_rgba(h: str) -> tuple:
    h = h.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), 255)


def dist2(a, b) -> int:
    return sum((x - y) ** 2 for x, y in zip(a[:3], b[:3]))


class Frame:
    def __init__(self, spec: dict, base: Image.Image, anims_colors: dict):
        self.spec = spec
        self.base = base
        self.canvas = base.copy()
        self.parts: Dict[str, Rect] = {k: tuple(v["rect"]) for k, v in spec["parts"].items()}
        self.fill_rule: Dict[str, object] = {k: v.get("fill", "row") for k, v in spec["parts"].items()}
        self.origin: Dict[str, Tuple[int, int]] = {k: (r[0], r[1]) for k, r in self.parts.items()}
        self.anchors: Dict[str, Tuple[int, int]] = {k: tuple(v) for k, v in spec.get("anchors", {}).items()}
        self.colors = spec.get("colors", {})

    # ---- 위치 해석 -------------------------------------------------------
    def at(self, name: str) -> Tuple[int, int]:
        if name in self.origin:
            return self.origin[name]
        if name in self.anchors:
            return self.anchors[name]
        raise KeyError(f"unknown anchor/part: {name}")

    # ---- 연산 -------------------------------------------------------------
    def move(self, part: str, dx: int, dy: int) -> None:
        x0, y0, x1, y1 = self.parts[part]
        piece = self.base.crop((x0, y0, x1, y1))
        self._vacate(part, dx, dy)
        self.canvas.paste(piece, (x0 + dx, y0 + dy), piece)
        self.origin[part] = (x0 + dx, y0 + dy)

    def raise_(self, part: str, dx: int, dy: int, shoulder: str) -> None:
        x0, y0, x1, y1 = self.parts[part]
        piece = self.base.crop((x0, y0, x1, y1))
        self._vacate(part, dx, dy)
        sx, sy = self.at(shoulder)
        hx, hy = x0 + dx + (x1 - x0) // 2, y0 + dy + 3
        self._arm((sx, sy), (hx, hy))
        self.canvas.paste(piece, (x0 + dx, y0 + dy), piece)
        self.origin[part] = (x0 + dx, y0 + dy)

    def move_to(self, part: str, anchor: str, dx: int, dy: int) -> None:
        x0, y0 = self.parts[part][:2]
        ax, ay = self.at(anchor)
        self.move(part, ax + dx - x0, ay + dy - y0)

    def raise_to(self, part: str, anchor: str, dx: int, dy: int, shoulder: str) -> None:
        x0, y0 = self.parts[part][:2]
        ax, ay = self.at(anchor)
        self.raise_(part, ax + dx - x0, ay + dy - y0, shoulder)

    def raise_lerp(self, part: str, anchor: str, t: float, shoulder: str) -> None:
        """파츠 원점에서 앵커까지 t(0~1) 비율만큼 간 위치로 올린다. 중간 프레임용."""
        x0, y0 = self.parts[part][:2]
        ax, ay = self.at(anchor)
        self.raise_(part, round((ax - x0) * t), round((ay - y0) * t), shoulder)

    def blink(self, parts: List[str]) -> None:
        eye_cols = [hex_rgba(c) for c in self.colors.get("eye", [])]
        lid = hex_rgba(self.colors["lid"]) if "lid" in self.colors else None
        for part in parts or [p for p in self.parts if p.startswith("eye")]:
            x0, y0, x1, y1 = self.parts[part]
            px = self.canvas.load()
            eye, other = [], []
            for y in range(y0, y1):
                for x in range(x0, x1):
                    c = px[x, y]
                    if c[3] == 0:
                        continue
                    (eye if any(dist2(c, e) <= 40 * 40 for e in eye_cols) else other).append((x, y, c))
            if not eye:
                continue
            if "eye_bg" in self.colors:
                bg = hex_rgba(self.colors["eye_bg"])
            elif other:
                bg = Counter(c for _, _, c in other).most_common(1)[0][0]
            else:
                continue
            fg = lid or Counter(c for _, _, c in eye).most_common(1)[0][0]
            for x, y, _ in eye:
                px[x, y] = bg
            xs = [x for x, _, _ in eye]
            ys = [y for _, y, _ in eye]
            cy = (min(ys) + max(ys)) // 2 + 1
            for x in range(min(xs), max(xs) + 1):
                px[x, cy] = fg

    def prop(self, name: str, at: str, dx: int, dy: int, variant: int) -> None:
        ax, ay = self.at(at)
        im = props.draw(name, variant)
        self.canvas.paste(im, (ax + dx, ay + dy), im)

    def fill(self, part: str, color: str) -> None:
        x0, y0, x1, y1 = self.parts[part]
        self.canvas.paste(Image.new("RGBA", (x1 - x0, y1 - y0), hex_rgba(color)), (x0, y0))

    # ---- 내부 -------------------------------------------------------------
    def _vacate(self, part: str, dx: int = 0, dy: int = 0) -> None:
        """파츠 사각형을 비우고 뒤 배경을 채운다.
        ["shift", n]: 같은 줄의 n 만큼 옆 영역을 복사(키보드 위 손처럼 뒤 배경이 이어질 때).
        그 외("row"/"col"): 이동 방향의 반대편 이웃 줄·열을 복제한다 — 아래로 옮기면 위 줄(대개 투명 배경),
        위로 옮기면 아래 줄(몸통). 기준 그림이 투명했던 자리는 그대로 투명으로 둔다."""
        x0, y0, x1, y1 = self.parts[part]
        w, h = x1 - x0, y1 - y0
        rule = self.fill_rule[part]
        patch = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        if isinstance(rule, list) and rule[0] == "shift":
            sx = x0 + int(rule[1])
            patch.paste(self.base.crop((sx, y0, sx + w, y1)), (0, 0))
        elif dy != 0:
            sy = y0 - 1 if dy > 0 else y1
            if 0 <= sy < self.base.height:
                row = self.base.crop((x0, sy, x1, sy + 1))
                for y in range(h):
                    patch.paste(row, (0, y))
        elif dx != 0:
            sx = x0 - 1 if dx > 0 else x1
            if 0 <= sx < self.base.width:
                col = self.base.crop((sx, y0, sx + 1, y1))
                for x in range(w):
                    patch.paste(col, (x, 0))
        patch.putalpha(ImageChops.multiply(patch.split()[3], self.base.crop((x0, y0, x1, y1)).split()[3]))
        self.canvas.paste(patch, (x0, y0))

    def _arm(self, a: Tuple[int, int], b: Tuple[int, int], width: int = 6) -> None:
        sleeve = hex_rgba(self.colors.get("sleeve", "#35578F"))
        shade = hex_rgba(self.colors.get("sleeve_shade", self.colors.get("sleeve", "#274877")))
        outline = hex_rgba(self.colors.get("outline", "#0E0D37"))
        px = self.canvas.load()
        W, H = self.canvas.size

        def stamp(cx, cy, r, col):
            for x in range(cx - r, cx + r + 1):
                for y in range(cy - r, cy + r + 1):
                    if 0 <= x < W and 0 <= y < H:
                        px[x, y] = col

        pts = _line(a, b)
        half = width // 2
        for x, y in pts:
            stamp(x, y, half + 1, outline)
        for x, y in pts:
            stamp(x, y, half, sleeve)
        for x, y in pts:
            stamp(x + 1, y + 1, max(half - 2, 0), shade)


def _line(a, b) -> List[Tuple[int, int]]:
    (x0, y0), (x1, y1) = a, b
    pts = []
    dx, dy = abs(x1 - x0), -abs(y1 - y0)
    sx, sy = (1 if x0 < x1 else -1), (1 if y0 < y1 else -1)
    err = dx + dy
    while True:
        pts.append((x0, y0))
        if x0 == x1 and y0 == y1:
            break
        e2 = 2 * err
        if e2 >= dy:
            err += dy
            x0 += sx
        if e2 <= dx:
            err += dx
            y0 += sy
    return pts


def render(spec: dict, base: Image.Image, ops: List[list]) -> Image.Image:
    f = Frame(spec, base, {})
    for op in ops:
        kind = op[0]
        if kind == "move":
            f.move(op[1], int(op[2]), int(op[3]))
        elif kind == "raise":
            f.raise_(op[1], int(op[2]), int(op[3]), op[4])
        elif kind == "move_to":
            f.move_to(op[1], op[2], int(op[3]), int(op[4]))
        elif kind == "raise_to":
            f.raise_to(op[1], op[2], int(op[3]), int(op[4]), op[5])
        elif kind == "raise_lerp":
            f.raise_lerp(op[1], op[2], float(op[3]), op[4])
        elif kind == "blink":
            f.blink(list(op[1:]))
        elif kind == "prop":
            f.prop(op[1], op[2], int(op[3]), int(op[4]), int(op[5]) if len(op) > 5 else 0)
        elif kind == "fill":
            f.fill(op[1], op[2])
        else:
            raise ValueError(f"unknown op {kind}")
    return f.canvas


def build(src_dir: pathlib.Path, out_dir: pathlib.Path, anims_path: pathlib.Path,
          gif_dir: Optional[pathlib.Path], only: Optional[List[str]]) -> None:
    spec = json.loads((src_dir / "character.json").read_text(encoding="utf-8"))
    anims = json.loads(anims_path.read_text(encoding="utf-8"))
    base = Image.open(src_dir / spec["base"]).convert("RGBA")
    cw, ch = spec["cell"]
    assert base.size == (cw, ch), f"base {base.size} != cell {spec['cell']}"
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest = {"cell": [cw, ch], "anims": {}}
    skip = set(spec.get("skip", []))
    for name, anim in anims.items():
        if only and name not in only:
            continue
        if name in skip:
            print(f"{name}: skipped by character.json")
            continue
        frames = [render(spec, base, ops) for ops in anim["frames"]]
        sheet = Image.new("RGBA", (cw * len(frames), ch), (0, 0, 0, 0))
        for i, fr in enumerate(frames):
            sheet.paste(fr, (i * cw, 0))
        sheet.save(out_dir / f"{name}.png")
        manifest["anims"][name] = {"frames": len(frames), "fps": anim["fps"], "label": anim.get("label", name)}
        if gif_dir:
            gif_dir.mkdir(parents=True, exist_ok=True)
            big = [fr.resize((cw * 3, ch * 3), Image.NEAREST) for fr in frames]
            bg = []
            for b in big:
                g = Image.new("RGBA", b.size, (28, 30, 38, 255))
                g.paste(b, (0, 0), b)
                bg.append(g)
            bg[0].save(gif_dir / f"{src_dir.name}_{name}.gif", save_all=True, append_images=bg[1:],
                       duration=int(1000 / anim["fps"]), loop=0, disposal=2)
        f0 = list(frames[0].getdata())
        diffs = [sum(1 for a, b in zip(f0, fr.getdata()) if a != b) * 100 / (cw * ch) for fr in frames[1:]]
        print(f"{src_dir.name}/{name}: {len(frames)}f @ {anim['fps']}fps, diff vs f0 = "
              + ", ".join(f"{d:.1f}%" for d in diffs))
    (out_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("src_dir", nargs="?")
    ap.add_argument("out_dir", nargs="?")
    ap.add_argument("--anims", default=str(pathlib.Path(__file__).resolve().parents[2] / "assets/sprites/animations.json"))
    ap.add_argument("--gif", default=None)
    ap.add_argument("--only", default=None)
    ap.add_argument("--empty", default=None, help="공용 빈자리 스프라이트를 이 경로에 쓴다")
    a = ap.parse_args()
    if a.empty:
        pathlib.Path(a.empty).parent.mkdir(parents=True, exist_ok=True)
        props.empty_desk().save(a.empty)
        print(f"empty: {a.empty}")
        if not a.src_dir:
            return
    build(pathlib.Path(a.src_dir), pathlib.Path(a.out_dir), pathlib.Path(a.anims),
          pathlib.Path(a.gif) if a.gif else None, a.only.split(",") if a.only else None)


if __name__ == "__main__":
    main()
