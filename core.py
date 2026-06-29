from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Callable, Iterable

import numpy as np
from PIL import Image, ImageChops, ImageFilter, ImageOps

SUPPORTED_EXTENSIONS = {'.png', '.jpg', '.jpeg', '.webp', '.bmp', '.tif', '.tiff'}

# rembg ONNX models. These are downloaded automatically on first use.
MODEL_HQ = 'isnet-general-use'
MODEL_CLASSIC = 'u2net'
MODEL_FAST = 'u2netp'
MODEL_HUMAN = 'u2net_human_seg'


def log_default(message: str) -> None:
    print(message, flush=True)


@dataclass(frozen=True)
class RemoveConfig:
    preset: str = 'hq'  # hq, soft, logo, human, fast, classic
    alpha_matting: bool = True
    fg_threshold: int = 240
    bg_threshold: int = 10
    erode_size: int = 10
    post_process_mask: bool = True
    edge_adjust: int = -1  # negative shrinks mask, positive expands mask
    feather: float = 0.0
    hard_threshold: int | None = None
    background: str | None = None


def get_model_name(preset: str) -> str:
    preset = (preset or 'hq').lower().strip()
    if preset in {'hq', 'soft', 'logo'}:
        return MODEL_HQ
    if preset == 'human':
        return MODEL_HUMAN
    if preset == 'classic':
        return MODEL_CLASSIC
    if preset == 'fast':
        return MODEL_FAST
    return MODEL_HQ


@lru_cache(maxsize=8)
def load_session(model_name: str):
    from rembg import new_session

    return new_session(model_name)


def _force_rgba(image: Image.Image) -> Image.Image:
    if image.mode == 'RGBA':
        return image
    # Use white as a neutral background for images that have palette/transparency weirdness.
    return image.convert('RGBA')


def _adjust_alpha(alpha: Image.Image, config: RemoveConfig) -> Image.Image:
    alpha = alpha.convert('L')

    if config.edge_adjust != 0:
        amount = abs(int(config.edge_adjust))
        # PIL MinFilter shrinks bright foreground, MaxFilter expands it.
        # Keep kernel odd and not enormous.
        radius = max(1, min(9, amount))
        size = radius * 2 + 1
        if config.edge_adjust < 0:
            alpha = alpha.filter(ImageFilter.MinFilter(size=size))
        else:
            alpha = alpha.filter(ImageFilter.MaxFilter(size=size))

    if config.hard_threshold is not None:
        t = max(0, min(255, int(config.hard_threshold)))
        alpha = alpha.point(lambda p: 255 if p >= t else 0)

    if config.feather and config.feather > 0:
        alpha = alpha.filter(ImageFilter.GaussianBlur(radius=float(config.feather)))

    return alpha


def _remove_isolated_speckles(alpha: Image.Image) -> Image.Image:
    # Small morphology cleanup without requiring OpenCV. Conservative by default.
    # This reduces tiny transparent/opaque dots around the edge.
    a = alpha.convert('L')
    opened = a.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.MaxFilter(3))
    # Blend with original to avoid destroying hair/fur too much.
    return Image.blend(a, opened, 0.25)


def _transparent_png_to_preview_bg(rgba: Image.Image, bg: str | None) -> Image.Image:
    if not bg:
        return rgba.convert('RGBA')
    background = Image.new('RGBA', rgba.size, bg)
    background.alpha_composite(rgba.convert('RGBA'))
    return background.convert('RGBA')


def remove_background_image(
    image: Image.Image,
    config: RemoveConfig,
    log: Callable[[str], None] = log_default,
) -> Image.Image:
    from rembg import remove

    image = _force_rgba(image)
    preset = (config.preset or 'hq').lower().strip()
    model = get_model_name(preset)
    session = load_session(model)

    use_alpha = bool(config.alpha_matting)
    if preset in {'logo', 'fast'}:
        use_alpha = False

    log(f'Model: {model}')
    log('First use downloads the model once. After that it starts faster.')
    log(f'Alpha matting: {use_alpha}')

    try:
        result = remove(
            image,
            session=session,
            post_process_mask=bool(config.post_process_mask),
            alpha_matting=use_alpha,
            alpha_matting_foreground_threshold=int(config.fg_threshold),
            alpha_matting_background_threshold=int(config.bg_threshold),
            alpha_matting_erode_size=int(config.erode_size),
        )
    except Exception as exc:
        if use_alpha:
            log(f'Alpha matting failed, fallback without alpha matting: {type(exc).__name__}: {exc}')
            result = remove(
                image,
                session=session,
                post_process_mask=bool(config.post_process_mask),
                alpha_matting=False,
            )
        else:
            raise

    if not isinstance(result, Image.Image):
        result = Image.open(result)
    result = result.convert('RGBA')

    alpha = result.getchannel('A')
    if config.post_process_mask:
        alpha = _remove_isolated_speckles(alpha)
    alpha = _adjust_alpha(alpha, config)

    # Keep original RGB pixels for maximum detail, use generated alpha mask.
    out = image.convert('RGBA')
    out.putalpha(alpha)

    return _transparent_png_to_preview_bg(out, config.background)


def remove_background(input_path: str | os.PathLike, output_path: str | os.PathLike, config: RemoveConfig) -> Path:
    input_path = Path(input_path)
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    image = Image.open(input_path)
    result = remove_background_image(image, config)
    result.save(output_path, 'PNG', optimize=True)
    return output_path


def iter_images(path: str | os.PathLike, recursive: bool = True) -> Iterable[Path]:
    root = Path(path)
    if root.is_file():
        if root.suffix.lower() in SUPPORTED_EXTENSIONS:
            yield root
        return
    pattern = '**/*' if recursive else '*'
    for file in root.glob(pattern):
        if file.is_file() and file.suffix.lower() in SUPPORTED_EXTENSIONS:
            yield file
