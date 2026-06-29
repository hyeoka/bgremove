from __future__ import annotations

import argparse
from pathlib import Path

from core import RemoveConfig, iter_images, remove_background


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description='High quality background remover')
    p.add_argument('input', help='Input image file or folder')
    p.add_argument('output', help='Output PNG file or folder')
    p.add_argument('--preset', default='hq', choices=['hq', 'soft', 'logo', 'human', 'classic', 'fast'])
    p.add_argument('--no-alpha-matting', action='store_true')
    p.add_argument('--fg-threshold', type=int, default=240)
    p.add_argument('--bg-threshold', type=int, default=10)
    p.add_argument('--erode-size', type=int, default=10)
    p.add_argument('--edge-adjust', type=int, default=-1)
    p.add_argument('--feather', type=float, default=0.0)
    p.add_argument('--hard-threshold', type=int, default=None)
    p.add_argument('--background', default=None)
    return p.parse_args()


def main() -> int:
    args = parse_args()
    inp = Path(args.input)
    out = Path(args.output)
    cfg = RemoveConfig(
        preset=args.preset,
        alpha_matting=not args.no_alpha_matting,
        fg_threshold=args.fg_threshold,
        bg_threshold=args.bg_threshold,
        erode_size=args.erode_size,
        edge_adjust=args.edge_adjust,
        feather=args.feather,
        hard_threshold=args.hard_threshold,
        background=args.background,
    )

    if inp.is_file():
        output_file = out if out.suffix else out / (inp.stem + '.png')
        print(f'Processing: {inp} -> {output_file}', flush=True)
        remove_background(inp, output_file, cfg)
        print('Done.', flush=True)
        return 0

    out.mkdir(parents=True, exist_ok=True)
    files = list(iter_images(inp))
    if not files:
        print(f'No images found in: {inp}', flush=True)
        return 1

    for i, file in enumerate(files, 1):
        rel = file.relative_to(inp)
        output_file = out / rel.with_suffix('.png')
        print(f'[{i}/{len(files)}] {file} -> {output_file}', flush=True)
        remove_background(file, output_file, cfg)
    print('Batch done.', flush=True)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
