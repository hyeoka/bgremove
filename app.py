from __future__ import annotations

import os
from tempfile import NamedTemporaryFile
from typing import Iterator

import gradio as gr
from PIL import Image

from core import RemoveConfig, remove_background_image

os.environ.setdefault('PYTHONUTF8', '1')

PRESET_CHOICES = [
    ('HQ General / product - recommended', 'hq'),
    ('Soft edges / hair / fur', 'soft'),
    ('Logo / icon sharp edge', 'logo'),
    ('Human portrait classic', 'human'),
    ('Classic U2Net', 'classic'),
    ('Fast preview only', 'fast'),
]


def preset_defaults(preset: str):
    preset = (preset or 'hq').lower().strip()
    if preset == 'logo':
        return gr.update(value=False), gr.update(value=-1), gr.update(value=0.0), gr.update(value=True), gr.update(value=150)
    if preset == 'soft':
        return gr.update(value=True), gr.update(value=-1), gr.update(value=0.25), gr.update(value=False), gr.update(value=128)
    if preset == 'fast':
        return gr.update(value=False), gr.update(value=0), gr.update(value=0.0), gr.update(value=False), gr.update(value=128)
    return gr.update(value=True), gr.update(value=-1), gr.update(value=0.0), gr.update(value=False), gr.update(value=128)


def remove_one(
    image: Image.Image,
    preset: str,
    alpha_matting: bool,
    fg_threshold: int,
    bg_threshold: int,
    erode_size: int,
    post_process_mask: bool,
    edge_adjust: int,
    feather: float,
    hard_cut: bool,
    hard_threshold: int,
    preview_bg: str,
) -> Iterator[tuple[Image.Image | None, str | None, str]]:
    if image is None:
        yield None, None, 'Put an image first.'
        return

    messages: list[str] = []

    def log(msg: str) -> None:
        messages.append(msg)
        print(msg, flush=True)

    yield None, None, 'Starting...\n' + '\n'.join(messages)

    bg_value = (preview_bg or '').strip()
    if bg_value.lower() in {'transparent', 'none'}:
        bg_value = ''

    config = RemoveConfig(
        preset=preset,
        alpha_matting=bool(alpha_matting),
        fg_threshold=int(fg_threshold),
        bg_threshold=int(bg_threshold),
        erode_size=int(erode_size),
        post_process_mask=bool(post_process_mask),
        edge_adjust=int(edge_adjust),
        feather=float(feather),
        hard_threshold=int(hard_threshold) if hard_cut else None,
        background=bg_value or None,
    )

    try:
        log(f'Preset: {preset}')
        if preset == 'fast':
            log('Warning: fast preview has low quality. Use HQ for final images.')
        log('Running...')
        yield None, None, 'Working...\n' + '\n'.join(messages)

        result = remove_background_image(image, config, log=log)
        tmp = NamedTemporaryFile(delete=False, suffix='.png')
        result.save(tmp.name, 'PNG', optimize=True)
        log('Done. Download PNG below.')
        yield result, tmp.name, 'Complete.\n' + '\n'.join(messages)
    except Exception as e:
        log(f'ERROR: {type(e).__name__}: {e}')
        yield None, None, 'Failed.\n' + '\n'.join(messages)


with gr.Blocks(title='BG Remover Pro v6 HQ') as demo:
    gr.Markdown(
        '# BG Remover Pro v6 HQ\n'
        'Default is HQ. First run may download the model, so wait and watch the terminal/status log.\n\n'
        '**Best starting point:** HQ General / product, Alpha matting ON, Edge adjust -1, Feather 0.'
    )

    with gr.Row():
        inp = gr.Image(type='pil', label='Original image')
        out = gr.Image(type='pil', label='Result PNG', image_mode='RGBA')

    with gr.Row():
        preset = gr.Dropdown(PRESET_CHOICES, value='hq', label='Quality preset')
        alpha_matting = gr.Checkbox(True, label='Alpha matting - better edges')
        post_process_mask = gr.Checkbox(True, label='Clean mask')

    with gr.Row():
        edge_adjust = gr.Slider(-5, 5, value=-1, step=1, label='Edge adjust: negative removes halo, positive keeps more edge')
        feather = gr.Slider(0, 2, value=0.0, step=0.05, label='Feather / soft edge')
        preview_bg = gr.Textbox(value='', label='Optional background: empty transparent / #000000 / white')

    with gr.Accordion('Advanced alpha matting settings', open=False):
        with gr.Row():
            fg_threshold = gr.Slider(1, 255, value=240, step=1, label='Foreground threshold')
            bg_threshold = gr.Slider(0, 254, value=10, step=1, label='Background threshold')
            erode_size = gr.Slider(1, 30, value=10, step=1, label='Erode size')
        with gr.Row():
            hard_cut = gr.Checkbox(False, label='Hard cut mask - good for logos, bad for hair')
            hard_threshold = gr.Slider(0, 255, value=128, step=1, label='Hard cut threshold')

    btn = gr.Button('Remove background', variant='primary')
    file_out = gr.File(label='PNG download')
    status = gr.Textbox(label='Status / log', lines=12)

    preset.change(
        fn=preset_defaults,
        inputs=[preset],
        outputs=[alpha_matting, edge_adjust, feather, hard_cut, hard_threshold],
    )

    btn.click(
        fn=remove_one,
        inputs=[
            inp,
            preset,
            alpha_matting,
            fg_threshold,
            bg_threshold,
            erode_size,
            post_process_mask,
            edge_adjust,
            feather,
            hard_cut,
            hard_threshold,
            preview_bg,
        ],
        outputs=[out, file_out, status],
    )


if __name__ == '__main__':
    demo.queue(max_size=2).launch(inbrowser=True)
