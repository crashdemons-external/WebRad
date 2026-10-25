# Third-party notices

MMSSTV 1.13A source code and original icon/toolbar artwork:
Copyright 2000–2013 Makoto Mori (JE3HHT) and Nobuyuki Oba (JA7UDE).
GNU Lesser General Public License, version 3 or later.
The checked-in original source is in `mmsstv-src/`.

The browser receiver reuses the original demodulator, FIR/IIR/LMS filters,
Hilbert demodulator, FFT, mode tables, synchronization, received-image drawing,
and original image-to-audio encoder/modulator.
Portable copies are generated during the build. The browser's About dialog
links to the [source repository](https://github.com/crashdemons-external/mmsstv-web),
which contains the original source and the port/build files.

See `COPYING.LESSER.txt` and `COPYING.txt` for license terms.

Emscripten and LLVM are official build tools; their generated runtime glue is
distributed with the compiled receiver under their applicable permissive
licenses. No third-party JavaScript UI or audio packages are used.

The corresponding Emscripten, musl, LLVM compiler-rt, libc++ and libc++abi
copyright/license texts are provided in `web/licenses/` (the built app's
`licenses/` directory). Their unmodified upstream sources are available from
the official [Emscripten project](https://github.com/emscripten-core/emscripten)
and [LLVM project](https://github.com/llvm/llvm-project).


QSSTV 9.5.11 source and additional toolbar icons: Johan Maes, ON4QZ, and
contributors. The HAMDRM receiver includes work by M. Bos, PA0MBO; the Dream
transmitter includes its original contributors' notices. Phil Karn's
Reed–Solomon code is retained with its upstream notice. The selected original
QSSTV/Dream sources are GPL-2.0-or-later; see the unmodified `qsstv-src/` tree
and `licenses/QSSTV-COPYING.txt`. The upstream tree also includes its
`LICENSE` file, copied to `licenses/QSSTV-LICENSE.txt`.
[Official QSSTV source](https://github.com/ON4QZ/QSSTV).

OpenJPEG 2.5.4: Université catholique de Louvain and its listed contributors,
BSD-2-Clause. The unmodified library is in `third_party/openjpeg/`; its license
is in `licenses/OpenJPEG.txt`.
[Official OpenJPEG source](https://github.com/uclouvain/openjpeg/tree/v2.5.4).
No OpenJPEG build/package installation scripts are executed.

The combined browser application and newly written shared UI/modem adapters
are GPL-3.0-or-later, compatible with the above GPL-2.0-or-later and
LGPL-3.0-or-later components. The independent MMSSTV core retains its original
LGPL-3.0-or-later terms. OpenJPEG retains BSD-2-Clause terms. Runtime JavaScript
loaders and WebAssembly binaries are distributed as separate files. No FFTW
library is linked: the browser boundary supplies its own small FFT-compatible
implementation for the original modem's calls.


Fldigi 4.2.13 WEFAX DSP: David Freese, W1HKJ, Remi Chateauneu and the
contributors credited in the selected original files under `third_party/fldigi/`.
Fldigi files are GPL-3.0-or-later; WEFAX includes HAMFAX code under
GPL-2.0-or-later; `gfft.h` is LGPL-3.0-or-later. Original source headers
and license notices are preserved. See `licenses/Fldigi-COPYING.txt`.
The browser boundary and streaming transmit adaptation originate in fldigi-web.
No fldigi UI, device backend, package installation or runtime dependency is used.
