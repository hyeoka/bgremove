from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
VENV = ROOT / '.venv'
VENV_PY = VENV / 'Scripts' / 'python.exe' if os.name == 'nt' else VENV / 'bin' / 'python'
REQ = ROOT / 'requirements.txt'

os.environ.setdefault('PYTHONUTF8', '1')
os.environ.setdefault('U2NET_HOME', str(ROOT / 'models'))


def run(cmd: list[str], *, check: bool = True) -> int:
    print('\n> ' + ' '.join(str(x) for x in cmd), flush=True)
    proc = subprocess.run(cmd, cwd=str(ROOT), env=os.environ.copy())
    if check and proc.returncode != 0:
        print('\nCommand failed. Screenshot this window from the top.')
        raise SystemExit(proc.returncode)
    return proc.returncode


def ensure_venv(force_install: bool = False) -> Path:
    print('BG Remover Pro v6 HQ')
    print(f'Folder: {ROOT}')
    print(f'Python: {sys.executable}')

    if not VENV_PY.exists():
        print('\n[1/4] Creating virtual environment...')
        run([sys.executable, '-m', 'venv', str(VENV)])
    else:
        print('\n[1/4] Virtual environment already exists.')

    print('\n[2/4] Upgrading pip tools...')
    run([str(VENV_PY), '-m', 'pip', 'install', '--upgrade', 'pip', 'setuptools', 'wheel'])

    marker = VENV / '.installed_ok_v6'
    if force_install or not marker.exists():
        print('\n[3/4] Installing packages. This can take a while.')
        print('First HQ run downloads the model once. That is normal.')
        run([str(VENV_PY), '-m', 'pip', 'install', '--prefer-binary', '-r', str(REQ)])
        marker.write_text('ok\n', encoding='utf-8')
    else:
        print('\n[3/4] Packages already installed.')

    print('\n[4/4] Ready.')
    return VENV_PY


def reset_env() -> None:
    if VENV.exists():
        print(f'Deleting {VENV} ...')
        shutil.rmtree(VENV)
    print('Done. Run START_HERE.cmd again.')


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--install-only', action='store_true')
    parser.add_argument('--reinstall', action='store_true')
    parser.add_argument('--reset', action='store_true')
    parser.add_argument('--batch-hq', action='store_true')
    parser.add_argument('--batch-logo', action='store_true')
    args = parser.parse_args()

    if args.reset:
        reset_env()
        return 0

    py = ensure_venv(force_install=args.reinstall)

    if args.install_only:
        print('Install complete. Now run START_HERE.cmd.')
        return 0

    input_dir = ROOT / 'input'
    output_dir = ROOT / 'output'
    input_dir.mkdir(exist_ok=True)
    output_dir.mkdir(exist_ok=True)

    if args.batch_hq:
        print(f'Batch input:  {input_dir}')
        print(f'Batch output: {output_dir}')
        return run([str(py), str(ROOT / 'cli.py'), str(input_dir), str(output_dir), '--preset', 'hq'], check=False)

    if args.batch_logo:
        print(f'Batch input:  {input_dir}')
        print(f'Batch output: {output_dir}')
        return run([str(py), str(ROOT / 'cli.py'), str(input_dir), str(output_dir), '--preset', 'logo', '--no-alpha-matting', '--hard-threshold', '150', '--edge-adjust', '-1'], check=False)

    print('\nStarting web UI...')
    print('Open this URL if browser does not open automatically: http://127.0.0.1:7860')
    return run([str(py), str(ROOT / 'app.py')], check=False)


if __name__ == '__main__':
    raise SystemExit(main())
