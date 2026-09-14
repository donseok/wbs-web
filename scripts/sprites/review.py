#!/usr/bin/env python3
"""검토용 시트: public/sprites/<char>/ 의 모든 애니메이션을 3배 확대해 세로로 쌓는다.

    python3 scripts/sprites/review.py public/sprites/<char> <out.png> [--scale 3]
"""
import argparse
import json
import pathlib

from PIL import Image, ImageDraw


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("sprite_dir")
    ap.add_argument("out")
    ap.add_argument("--scale", type=int, default=3)
    a = ap.parse_args()
    d = pathlib.Path(a.sprite_dir)
    m = json.loads((d / "manifest.json").read_text(encoding="utf-8"))
    rows = []
    for n in m["anims"]:
        sh = Image.open(d / f"{n}.png")
        rows.append((n, sh.resize((sh.width * a.scale, sh.height * a.scale), Image.NEAREST)))
    W = max(r.width for _, r in rows) + 8
    H = sum(r.height + 22 for _, r in rows)
    out = Image.new("RGBA", (W, H), (40, 40, 48, 255))
    dr = ImageDraw.Draw(out)
    y = 0
    for n, r in rows:
        dr.text((4, y + 4), n, fill=(255, 255, 0, 255))
        out.paste(r, (4, y + 20), r)
        y += r.height + 22
    out.save(a.out)
    print(a.out, out.size)


if __name__ == "__main__":
    main()
