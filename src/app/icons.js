/** SVG icon and brand markup used by the workflow view. */
export class Icons {
    /** SVG path data indexed by icon name. */
    static paths = {
        file: 'M14 2H5a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9z M14 2v7h7',
        text: 'M14 2H5a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9z M14 2v7h7 M7 12h9 M7 16h9 M7 8h3',
        picture:
            'M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z M3 17l5-5 4 4 4-7 5 8 M8 7h.01',
        gear: 'M9 3l1-1h4l1 3 3 1 3-1 2 4-2 2v3l2 2-2 4-3-1-3 1-1 3h-4l-1-3-3-1-3 1-2-4 2-2v-3l-2-2 2-4 3 1 3-1z M15.5 12a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0',
        help: 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0 M9.3 8a3 3 0 0 1 5.8 1c0 2-3 2-3 4 M12 17h.01',
        sun: 'M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M12 2v2 M12 20v2 M2 12h2 M20 12h2 M5 5l1.5 1.5 M17.5 17.5L19 19 M5 19l1.5-1.5 M17.5 6.5L19 5',
        moon: 'M20.9 13a9 9 0 0 1-9.9-9.9A9 9 0 1 0 20.9 13z',
        down: 'M6 9l6 6 6-6',
        close: 'M6 6l12 12 M18 6L6 18',
        right: 'M9 5l7 7-7 7',
        play: 'M8 4l12 8-12 8z',
        decode: 'M1 12h2V6h4v12h4V6h2v6 M16 12h7 M20 9l3 3-3 3 M29 4h10a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H29a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z M30 8h3v8h-3z M36 9l1-1v8',
        encode: 'M3 4h10a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z M4 8h3v8H4z M10 9l1-1v8 M19 12h7 M23 9l3 3-3 3 M29 12h2V6h4v12h4V6h2v6',
        pause: 'M7 4v16 M17 4v16',
        download: 'M12 3v12 M7 10l5 5 5-5 M4 15v5h16v-5',
        volume: 'M11 4L6 8H2v8h4l5 4z M15 8a6 6 0 0 1 0 8 M18 5a10 10 0 0 1 0 14',
        muted: 'M11 4L6 8H2v8h4l5 4z M16 9l6 6 M22 9l-6 6',
        fit: 'M4 9V4h5 M15 4h5v5 M20 15v5h-5 M9 20H4v-5 M8 8l-4-4 M16 8l4-4 M16 16l4 4 M8 16l-4 4',
        crop: 'M6 2v16h16 M2 6h16v16',
        device: 'M4 3h16v13H4z M2 20h20l-2-4H4z',
        info: 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0 M12 11v6 M12 7h.01',
        search: 'M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0 M16 16l6 6',
        arrow: 'M3 12h18 M16 7l5 5-5 5',
        mic: 'M8 4a4 4 0 0 1 8 0v8a4 4 0 0 1-8 0z M5 10v2a7 7 0 0 0 14 0v-2 M12 19v3 M8 22h8',
        more: 'M5 12h.01 M12 12h.01 M19 12h.01',
        morse: 'M2 12h.01 M6 12h.01 M11 12h4 M19 12h3',
        sine: 'M1 12c4 0 2-9 6-9s3 18 7 18 3-18 7-18 3 9 5 9',
        keyboard:
            'M2 5h20v14H2z M6 9h.01 M10 9h.01 M14 9h.01 M18 9h.01 M6 13h.01 M10 13h.01 M14 13h.01 M18 13h.01 M8 16h8',
        bars: 'M2 9v6 M6 4v16 M10 7v10 M14 2v20 M18 5v14 M22 9v6'
    };
    /**
     * Render the requested SVG icon with the established accessibility and styling attributes.
     * @param {string} name Icon name.
     * @param {string} extra Additional icon CSS classes.
     * @returns {string} SVG icon markup.
     */
    static icon(name, extra = '') {
        const conversion = name === 'decode' || name === 'encode';
        const viewBox = conversion ? '0 0 42 24' : '0 0 24 24';
        const iconClass = conversion ? `icon ${name}-icon` : 'icon';
        return `<svg class="${iconClass} ${extra}" viewBox="${viewBox}" aria-hidden="true"><path d="${Icons.paths[name] || Icons.paths.file}"/></svg>`;
    }
    /**
     * Render the WebRad SVG brand mark.
     * @returns {string} SVG brand markup.
     */
    static logo() {
        return '<svg class="logo" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" aria-hidden="true"><path d="M3 21v6 M11 12v24 M20 4v40 M29 12v24 M38 20v8 M44 23v2"/></svg>';
    }
}
export const icon = Icons.icon.bind(Icons);
export const logo = Icons.logo.bind(Icons);
