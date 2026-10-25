# Notices for additional radio and sound engines

This inventory covers the additional pinned subsets listed in `docs/engine-sources.md`. Individual file notices take precedence. Browser adapters and compiled WebAssembly are included with the application; original file notices remain in `src/engines/`.

| Capability | Main terms | Additional terms retained |
| --- | --- | --- |
| Packet radio / Dire Wolf | GPL version 2 or later, `../packet-radio/LICENSE` | BSD helpers in `src/engines/modems/packet-radio/external/misc`; GEOTRANS terms in `src/engines/modems/packet-radio/external/geotranz/readme.txt`. |
| Weak signal / ft8_lib | MIT, `../weak-signal/LICENSE` | Bundled KISS FFT is BSD 3-Clause. `../weak-signal/kissfft-COPYING` and `../weak-signal/kissfft-BSD-3-Clause` supply its copyright and complete license missing from the upstream subset. |
| Sound messages / ggwave | MIT, `../sound-messages/LICENSE` | Reed-Solomon MIT notice in `../sound-messages/reed-solomon-LICENSE`; Ooura FFT copyright in `src/engines/modems/sound-messages/src/fft.h` and complete permissive terms in `../sound-messages/ooura-fft.html`. |
| Signaling / multimon-ng | Mostly GPL version 2 or later, `../signaling/COPYING` | **FLEX decoder files use GPL version 3 or later.** A build combining them with GPL-2-or-later files must use compatible GPL-3-or-later terms; `../signaling/GPL-3.0.txt` is supplied. cJSON MIT and BCH/new generator Unlicense notices remain in file headers. |
| Digital voice / Codec2 and FreeDV | LGPL version 2.1, `../digital-voice/COPYING` | KISS FFT BSD 3-Clause headers; Mozilla BSD-style notice in `lpcnet_freq.c`; public-domain `optparse.h`. External LPCNet library/model assets are excluded. |
| Sensor radio / rtl_433 | GPL version 2 or later, `../sensor-radio/COPYING` | Original file notices retained; Mongoose/networking, SDR drivers and CLI host excluded. |

Ooura permits use, copying, modification and distribution for any purpose,
including commercial use, without a fee, and requests reference to the package
when modifying it. See the saved licensing page for exact terms.

GEOTRANS's readme grants use/distribution/derivative-work rights and requests:
"The product was developed using GEOTRANS, a product of the National
Geospatial-Intelligence Agency (NGA) and U.S. Army Engineering Research and
Development Center." It also prohibits implying government endorsement.
Preserve its readme and credit when using that support code.

## Distribution

Keep applicable license texts and copyright notices with the deployed engine
files. The full source snapshots, adapters, and build recipes are retained in
this project. Version and archive details are listed in `docs/engine-sources.md`.
The application build includes the central notices in the static-site distribution.

Supplemental FFT documents come from the official
[KISS FFT repository](https://github.com/mborgerding/kissfft) and
[Ooura author page](https://www.kurims.kyoto-u.ac.jp/~ooura/fft.html). Their
source revisions and archive hashes are recorded in `docs/engine-sources.md`.
The complete GPL version 3 text was byte-copied from the QSSTV source snapshot;
see `licenses/engines/hamdrm/COPYING`.
