# Aircraft message engine notices

The retained `acars.c`, `msk.c` and `acarsdec.h` headers identify the GNU **Library** General Public License, version 2. Copyright Thierry Leconte (2007, 2015, 2025 as stated per file) and Thibaut VARENE (2024).

- [Original upstream project license](LICENSE.md): GNU GPL version 2. Kept verbatim; it does not replace the individual source headers.
- [GNU Library GPL version 2](LGPL-2.0.txt): unmodified license text obtained from https://www.gnu.org/licenses/old-licenses/lgpl-2.0.txt.
- Pinned source: https://github.com/f00b4r0/acarsdec/tree/ae23498013b962ba2c7bfd9ba9ade712cc297254
- Source inventory and hashes: `src/engines/modems/aircraft-messages/SOURCE.json`.

WebRad supplies the synchronous PCM boundary, result formatting and transmitter. No acarsdec executable, SDR driver, sound-file library, libacars, network output or upstream build script is used. Build preparation retains parity and CRC validation while removing queue threads and metrics output. Source and project-owned preparation scripts must accompany distributed builds under the applicable license terms; these compiled files are not a closed-source replacement for the native sources.
