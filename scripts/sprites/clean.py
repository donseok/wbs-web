#!/usr/bin/env python3
"""생성 이미지(격자 없음)를 픽셀 아트 기준 그림으로 정리한다.

    python3 scripts/sprites/clean.py <in.png> <out.png> [--size 64] [--colors 24] [--alpha 0.5]

단계: 박스 다운샘플 → 알파 이진화 → 불투명 픽셀만 median-cut 팔레트 양자화 → 팔레트 PNG 저장.
생성 이미지에는 픽셀 격자가 없다는 것이 2026-09-10 실측(런 길이 최빈값 1)이라 격자 위상 탐색은 하지 않는다.
"""
import argparse
from PIL import Image


def clean(src: Image.Image, size: int, colors: int, alpha_cut: float, merge_dist: int = 10) -> Image.Image:
    im = src.convert("RGBA")
    # 투명 영역 색이 섞이지 않도록 알파를 곱한 뒤 축소한다.
    small = im.resize((size, size), Image.BOX)
    px = small.load()
    w, h = small.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < int(255 * alpha_cut):
                px[x, y] = (0, 0, 0, 0)
            else:
                # 반투명으로 어두워진 가장자리 색을 알파로 되돌린다.
                k = 255 / a
                px[x, y] = (min(255, int(r * k)), min(255, int(g * k)), min(255, int(b * k)), 255)
    # 불투명 픽셀만 양자화한다. 투명은 마젠타 키로 두고 양자화 뒤 복원한다.
    key = (255, 0, 255)
    rgb = Image.new("RGB", small.size, key)
    rgb.paste(small.convert("RGB"), mask=small.split()[3])
    pal = rgb.quantize(colors=colors + 1, method=Image.MEDIANCUT, dither=Image.NONE).convert("RGB")
    # 키 색으로 떨어진 불투명 픽셀과, 거의 같은 색으로 갈라진 팔레트 항목을 정리한다.
    used = sorted({pal.getpixel((x, y)) for y in range(h) for x in range(w) if px[x, y][3]} - {key})
    merged: dict = {}
    for c in used:
        for m in merged.values():
            if sum((a - b) ** 2 for a, b in zip(c, m)) <= merge_dist ** 2:
                merged[c] = m
                break
        else:
            merged[c] = c

    def nearest(c):
        return min(set(merged.values()), key=lambda m: sum((a - b) ** 2 for a, b in zip(c, m)))

    out = Image.new("RGBA", small.size, (0, 0, 0, 0))
    op = out.load()
    pp = pal.load()
    for y in range(h):
        for x in range(w):
            if px[x, y][3]:
                c = pp[x, y]
                c = merged[c] if c in merged else nearest(px[x, y][:3])
                op[x, y] = c + (255,)
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("dst")
    ap.add_argument("--size", type=int, default=64)
    ap.add_argument("--colors", type=int, default=24)
    ap.add_argument("--alpha", type=float, default=0.5)
    a = ap.parse_args()
    out = clean(Image.open(a.src), a.size, a.colors, a.alpha)
    out.save(a.dst)
    used = len({p for p in out.getdata() if p[3]})
    print(f"{a.dst}: {out.size[0]}x{out.size[1]}, {used} colors")


if __name__ == "__main__":
    main()
