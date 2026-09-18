#!/usr/bin/env python3
"""告知バナーなどの画像からカード1枚の領域を切り出す。

なぜ必要か:
  1920x1080 のバナーをそのまま読むと、カード内の小さな文字（能力文・カード番号）が
  実効解像度で潰れる。カード領域だけを切り出して拡大すると、同じ元画像から
  読み取れる文字が増える。読み取り精度そのものが上がるわけではなく、
  「読める画素数」が増えるだけである点に注意。

使い方:
  python3 tools/crop-card.py IN.jpg OUT.png              # 自動検出
  python3 tools/crop-card.py IN.jpg OUT.png --box x,y,w,h # 手動指定
  オプション: --scale 2.0 （拡大倍率） / --pad 8 （余白px）

自動検出の考え方:
  カードのイラストと枠は細かい絵柄で「密」だが、バナーの背景は平坦。
  縮小画像の勾配で密な領域を求め、連続する列・行の塊を出し、
  そのうち縦横比がカードらしいもの（既知カードは 0.71〜0.73）を選ぶ。
  レイアウトが変わると外すので、**必ず出力画像を目視で確認すること。**
  外したときは --box で指定する。
"""
import sys, argparse
from PIL import Image

try:
    import numpy as np
except ImportError:
    sys.exit("numpy が必要です: pip3 install numpy Pillow")

CARD_ASPECT = 0.718          # 幅 / 高さ。既知カード画像の実測（594/827）
ASPECT_TOL  = 0.10


def _runs(counts, thr, k, min_len=5):
    out, start = [], None
    for i, v in enumerate(counts):
        if v >= thr and start is None:
            start = i
        elif v < thr and start is not None:
            if i - start >= min_len:
                out.append((start * k, i * k))
            start = None
    if start is not None and len(counts) - start >= min_len:
        out.append((start * k, len(counts) * k))
    return out


def detect(img, k=8):
    """細かい絵柄の密度からカードらしい矩形を推定する。見つからなければ None。"""
    g = img.convert("L")
    W, H = g.size
    small = np.asarray(g.resize((max(1, W // k), max(1, H // k)), Image.BILINEAR), dtype=np.float32)
    gx = np.abs(np.diff(small, axis=1, prepend=small[:, :1]))
    gy = np.abs(np.diff(small, axis=0, prepend=small[:1, :]))
    mask = (gx + gy) > 12
    col_runs = _runs(mask.sum(axis=0), mask.shape[0] * 0.25, k)
    row_runs = _runs(mask.sum(axis=1), mask.shape[1] * 0.10, k)
    best = None
    for x0, x1 in col_runs:
        for y0, y1 in row_runs:
            w, h = x1 - x0, y1 - y0
            if w < 80 or h < 110:
                continue
            err = abs((w / h) - CARD_ASPECT)
            if err > ASPECT_TOL:
                continue
            if best is None or err < best[0]:
                best = (err, (x0, y0, w, h))
    return best[1] if best else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src"); ap.add_argument("dst")
    ap.add_argument("--box", help="x,y,w,h を手動指定（自動検出を使わない）")
    ap.add_argument("--scale", type=float, default=1.0, help="切り出し後の拡大倍率")
    ap.add_argument("--pad", type=int, default=0, help="四辺に足す余白（px）")
    a = ap.parse_args()

    img = Image.open(a.src)
    if a.box:
        x, y, w, h = (int(v) for v in a.box.split(","))
        how = "手動指定"
    else:
        box = detect(img)
        if box is None:
            sys.exit("カードらしい矩形を検出できませんでした。--box x,y,w,h で指定してください。")
        x, y, w, h = box
        how = "自動検出"

    x0, y0 = max(0, x - a.pad), max(0, y - a.pad)
    x1, y1 = min(img.width, x + w + a.pad), min(img.height, y + h + a.pad)
    out = img.crop((x0, y0, x1, y1))
    if a.scale != 1.0:
        out = out.resize((round(out.width * a.scale), round(out.height * a.scale)), Image.LANCZOS)
    out.save(a.dst)
    print(f"{how}: box={x0},{y0},{x1-x0},{y1-y0}  比={(x1-x0)/(y1-y0):.3f}  "
          f"元={img.width}x{img.height} → 出力={out.width}x{out.height} ({a.dst})")
    print("※ 出力を目視で確認すること。外していたら --box で指定し直す。")


if __name__ == "__main__":
    main()
