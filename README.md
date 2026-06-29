# BG Remover Pro v6 HQ

High quality local background remover for Windows.

## How to run

1. Extract this ZIP.
2. Double click `START_HERE.cmd`.
3. Wait for install.
4. Open `http://127.0.0.1:7860` if browser does not open.
5. Upload image and click `Remove background`.

## Best settings

### Normal product / object / general image
- Preset: `HQ General / product - recommended`
- Alpha matting: ON
- Edge adjust: -1
- Feather: 0
- Hard cut: OFF

### Hair / fur / soft edge
- Preset: `Soft edges / hair / fur`
- Alpha matting: ON
- Edge adjust: -1
- Feather: 0.15 to 0.35
- Hard cut: OFF

### Logo / icon / clean graphic
- Preset: `Logo / icon sharp edge`
- Alpha matting: OFF
- Edge adjust: -1
- Feather: 0
- Hard cut: ON
- Hard threshold: 150

## Batch mode

Put images in `input`, then run:

- `RUN_BATCH_HQ.cmd` for normal high quality images
- `RUN_BATCH_LOGO.cmd` for sharp logos/icons

Results are saved in `output` as PNG.

## Important

The first HQ run downloads the model once. It can look slow at first.
After the model is downloaded, later runs are faster.

Fast preview is low quality by design. Do not use it for final output.
