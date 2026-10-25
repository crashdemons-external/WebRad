"""Build one engine capability or all browser engine capabilities."""
from pathlib import Path
import argparse
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
ENGINES = [
    'beacon-messages', 'aircraft-messages', 'terminal-tones', 'radio-identifiers', 'spectral-pictures', 'satellite-pictures',
    'multimode', 'analog-sstv', 'hamdrm', 'jpeg2000', 'weather-fax',
    'packet-radio', 'weak-signal', 'sound-messages', 'signaling', 'digital-voice', 'sensor-radio'
]
RECIPES = {
    'multimode': ROOT / 'scripts/engines/modems/multimode/build.py',
    'analog-sstv': ROOT / 'scripts/engines/slow-scan/analog-sstv/build.py',
    'hamdrm': ROOT / 'scripts/engines/file-transfer/hamdrm/build.py',
    'jpeg2000': ROOT / 'scripts/engines/image-codecs/jpeg2000/build.py',
    'weather-fax': ROOT / 'scripts/engines/weather-fax/weather-fax/build.py'
}
FOCUSED = ROOT / 'scripts/engines/modems/build.py'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--engine', choices=['all', *ENGINES], default='all')
    parser.add_argument('--emsdk', type=Path, help='Path to an existing Emscripten SDK installation')
    parser.add_argument('--debug', action='store_true')
    parser.add_argument('--prepare-only', action='store_true')
    args = parser.parse_args()
    options = []
    if args.emsdk:
        options += ['--emsdk', str(args.emsdk.resolve())]
    if args.debug:
        options.append('--debug')
    if args.prepare_only:
        options.append('--prepare-only')

    for name in ['beacon-messages', 'aircraft-messages', 'terminal-tones', 'radio-identifiers', 'spectral-pictures', 'satellite-pictures']:
        RECIPES[name] = ROOT / 'scripts/engines/additional/build.py'
    selected = ENGINES if args.engine == 'all' else [args.engine]
    for name in selected:
        if name in RECIPES:
            command = [sys.executable, '-B', str(RECIPES[name]), *(['--engine', name] if RECIPES[name].parent.name == 'additional' else []), *options]
        else:
            command = [sys.executable, '-B', str(FOCUSED), '--engine', name, *options]
        subprocess.run(command, cwd=ROOT, check=True)


if __name__ == '__main__':
    main()
