/** Safe DOM queries and escaped markup interpolation. */
export class Dom {
    /** Query one element in a document or element subtree.
     * @param {string} q CSS selector.
     * @param {Document|Element} root Query root.
     * @returns {Element|null} The first matching element.
     */
    static query(q, root = document) {
        return root.querySelector(q);
    }
    /** Escape special HTML characters in displayed data.
     * @param {*} x Displayed value to escape.
     * @returns {string} Safe HTML text.
     */
    static escape(x) {
        return String(x ?? '').replace(
            /[&<>"']/g,
            (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
        );
    }
}
export const $ = Dom.query.bind(Dom);
export const esc = Dom.escape.bind(Dom);
