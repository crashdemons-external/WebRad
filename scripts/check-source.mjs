import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'acorn';
import { ROOT, filesUnder, isMain, fail } from './tooling.mjs';

/** Checks class, method and property documentation in the app and build scripts. */
export class SourceInspector {
    /**
     * Get the JSDoc before a declaration, allowing an intervening export keyword.
     * @param {string} source Complete module text.
     * @param {Object[]} comments Parsed comments in source order.
     * @param {Object} node Class or member being documented.
     * @returns {string} JSDoc content, or an empty string when missing.
     */
    static documentation(source, comments, node) {
        const comment = comments.findLast((value) => value.end <= node.start);
        if (!comment || comment.type !== 'Block' || !comment.value.startsWith('*')) return '';
        const between = source.slice(comment.end, node.start);
        return /^\s*(?:export\s+(?:default\s+)?)?$/.test(between) ? comment.value : '';
    }

    /**
     * Visit each syntax node under a node.
     * @param {Object} node Parsed syntax node.
     * @param {Function} visit Callback receiving each syntax node.
     */
    static walk(node, visit) {
        if (!node || typeof node !== 'object' || !node.type) return;
        visit(node);
        for (const value of Object.values(node)) {
            if (Array.isArray(value)) value.forEach((child) => SourceInspector.walk(child, visit));
            else if (value && typeof value === 'object') SourceInspector.walk(value, visit);
        }
    }

    /**
     * Check a module's documentation and count its classes and members.
     * @param {string} source Complete JavaScript module text.
     * @param {string} name Relative source filename for failure messages.
     * @returns {{classes:number,methods:number,properties:number}} Coverage counts.
     */
    static module(source, name) {
        const comments = [],
            failures = [];
        const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module', onComment: comments });
        const totals = { classes: 0, methods: 0, properties: 0 };
        SourceInspector.walk(ast, (node) => {
            if (node.type === 'FunctionDeclaration')
                failures.push(`${name}: standalone function ${node.id.name}; use a class method`);
            if (node.type !== 'ClassDeclaration' && node.type !== 'ClassExpression') return;
            totals.classes++;
            const className = node.id?.name || 'anonymous class';
            const doc = SourceInspector.documentation(source, comments, node);
            if (!doc.trim()) failures.push(`${name}: ${className} lacks JSDoc`);
            const properties = new Set(),
                documented = new Set();
            for (const member of node.body.body) {
                const key = member.key?.name || member.key?.value;
                if (!key) continue;
                const memberDoc = SourceInspector.documentation(source, comments, member);
                if (!memberDoc.trim()) failures.push(`${name}: ${className}.${key} lacks JSDoc`);
                if (member.type === 'MethodDefinition') totals.methods++;
                else if (member.type === 'PropertyDefinition') {
                    properties.add(key);
                    if (memberDoc.trim()) documented.add(key);
                }
            }
            SourceInspector.walk(node.body, (child) => {
                if (!['AssignmentExpression', 'UpdateExpression'].includes(child.type)) return;
                const target = child.left || child.argument;
                if (target?.type === 'MemberExpression' && target.object.type === 'ThisExpression' && !target.computed)
                    properties.add(target.property.name);
            });
            for (const key of properties) {
                totals.properties++;
                if (!documented.has(key) && !new RegExp(`@property\\s+\\{[^}]+\\}\\s+${key}\\s`).test(doc))
                    failures.push(`${name}: ${className}.${key} lacks property documentation`);
            }
        });
        if (failures.length) throw Error(failures.join('\n'));
        return totals;
    }

    /**
     * Check the application modules and Node build scripts.
     * @param {string} root Absolute project directory.
     * @returns {Promise<Object>} File and member coverage counts.
     */
    static async project(root = ROOT) {
        const totals = { files: 0, classes: 0, methods: 0, properties: 0 };
        for (const directory of ['src/app', 'scripts']) {
            for (const name of await filesUnder(join(root, directory))) {
                if (!/\.(js|mjs)$/.test(name)) continue;
                const relative = `${directory}/${name}`;
                const result = SourceInspector.module(await readFile(join(root, relative), 'utf8'), relative);
                totals.files++;
                for (const key of ['classes', 'methods', 'properties']) totals[key] += result[key];
            }
        }
        return totals;
    }
}

if (isMain(import.meta.url)) {
    try {
        const result = await SourceInspector.project();
        console.log(
            `Documented source: ${result.files} ESM files, ${result.classes} classes, ${result.methods} methods, ${result.properties} properties.`
        );
    } catch (error) {
        fail(error);
    }
}
