/** Applies the browser theme until the user saves an explicit choice. */
class ThemeController {
    /** Saved light/dark choice, or null while following the browser. */
    preference = null;
    /** Whether appearance changes may be saved beyond this page. */
    storeSettings = true;
    /** Browser preference, including changes made while the app is open. */
    media = window.matchMedia('(prefers-color-scheme: dark)');

    /** Read only recognized preferences; storage may be unavailable in private contexts. */
    readPreference() {
        if (!this.storeSettings) return null;
        try {
            const saved = localStorage.getItem('webrad.theme');
            return saved === 'light' || saved === 'dark' ? saved : null;
        } catch {
            return null;
        }
    }

    /** Apply the theme before styles load and register preference changes. */
    start() {
        this.storeSettings = this.storagePreference();
        this.preference = this.readPreference();
        this.apply();
        this.media.addEventListener('change', () => {
            if (!this.preference) this.apply();
        });
        document.addEventListener('click', (event) => {
            if (event.target.closest('.theme-toggle')) this.toggle();
        });
        window.addEventListener('storage', (event) => {
            if (!['webrad.theme', 'webrad.storage', null].includes(event.key)) return;
            this.storeSettings = this.storagePreference();
            if (!this.storeSettings) return;
            this.preference = this.readPreference();
            this.apply();
        });
        window.addEventListener('webrad-storage-change', (event) => {
            this.storeSettings = event.detail.enabled;
            if (this.storeSettings) this.persistPreference();
        });
    }

    /** Read the shared storage choice, retaining the page's choice if storage is denied.
     * @returns {boolean} Whether preferences may be saved.
     */
    storagePreference() {
        try {
            return localStorage.getItem('webrad.storage') !== 'off';
        } catch {
            return this.storeSettings;
        }
    }

    /** Save an explicit appearance choice when preference storage is enabled. */
    persistPreference() {
        if (!this.preference || !this.storeSettings || !this.storagePreference()) return;
        try {
            localStorage.setItem('webrad.theme', this.preference);
        } catch {}
    }

    /** Update colors and save the choice when enabled, without replacing workflow or audio elements. */
    toggle() {
        this.preference = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
        this.persistPreference();
        this.apply();
    }

    /** Update shared colors, browser chrome and the toggle's accessible state. */
    apply() {
        const theme = this.preference || (this.media.matches ? 'dark' : 'light');
        document.documentElement.dataset.theme = theme;
        const themeColor = document.querySelector('meta[name="theme-color"]');
        if (themeColor) themeColor.content = theme === 'dark' ? '#14191c' : '#f3f7fa';
        for (const button of document.querySelectorAll('.theme-toggle')) {
            button.setAttribute('aria-pressed', String(theme === 'dark'));
            button.title = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
        }
    }
}

new ThemeController().start();
