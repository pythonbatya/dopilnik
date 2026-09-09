import * as path from 'node:path';
import * as vscode from 'vscode';
import { bothTitle, childrenTitle, NAV_COMMAND, parentTitle, parseNavArgs, type NavArgs } from './hoverLinks';
import {
    classForBaseAt,
    classForLine,
    defForLine,
    defOfNameInClass,
    defForNameAt,
    findClasses,
    findDefs,
    type ClassInfo,
    type DefInfo,
} from './symbols';
import { collectBoth, collectTree, splitByDirection, type WalkBranch, type WalkQueries } from './walker';
import { openResultEditor, registerResultDoc, type ResultDocOptions } from '../../shared-result/src/resultDoc';

const RESULT_DOC: ResultDocOptions = {
    scheme: 'pyhierarchy',
    languageId: 'pyhierarchy-result',
    commandId: 'pyHierarchy.openAtCursor',
};

const DEBOUNCE_MS = 300;
const MAX_ANCHORS_PER_PASS = 40;
const MAX_ANCHORS_PER_LENS = 150;
const VISIBLE_MARGIN_LINES = 5;
const MAX_TREE_CHILDREN = 50;
const EMPTY_TTL_MS = 1200;
/** retry delays while every query answers empty (cold server): dense at first, then backing off */
const COLD_RETRY_DELAYS_MS = [150, 300, 600, 1000, 1500, 2500, 4000, 6000, 8000, 10000];
const COLD_RETRY_MAX_MS = 10000;

/** full-height half-width arrows: parents = left column, children = right column */
let gutterUp: vscode.TextEditorDecorationType;
let gutterDown: vscode.TextEditorDecorationType;
let gutterBoth: vscode.TextEditorDecorationType;

/** versioned LSP query cache; keys embed the doc version and are bulk-dropped on edit */
const cache = new Map<string, Promise<unknown>>();
const emptySince = new Map<string, number>();

function cached<T>(key: string, compute: () => Promise<T>): Promise<T> {
    const hit = cache.get(key) as Promise<T> | undefined;
    if (hit !== undefined) return hit;
    const value = compute();
    cache.set(key, value);
    return value;
}

/**
 * location queries cache empty answers only briefly: a cold language server
 * often answers [] before it finished resolving imports, and the passes
 * would then keep the empty result forever (or re-query it on every pass)
 */
function cachedLocations(key: string, compute: () => Promise<vscode.Location[]>): Promise<vscode.Location[]> {
    const hit = cache.get(key) as Promise<vscode.Location[]> | undefined;
    if (hit !== undefined) {
        const at = emptySince.get(key);
        if (at === undefined || Date.now() - at < EMPTY_TTL_MS) return hit;
        cache.delete(key);
        emptySince.delete(key);
    }
    const value = compute().then((res) => {
        if (res.length === 0) emptySince.set(key, Date.now());
        else emptySince.delete(key);
        cache.set(key, value);
        return res;
    });
    return value;
}

function invalidateUri(uri: vscode.Uri): void {
    const prefix = `${uri.toString()}#`;
    for (const key of cache.keys()) {
        if (key.startsWith(prefix)) cache.delete(key);
    }
}

async function docFor(uri: vscode.Uri): Promise<vscode.TextDocument> {
    return vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString())
        ?? vscode.workspace.openTextDocument(uri);
}

async function queryLocations(command: string, uri: vscode.Uri, line: number, col: number): Promise<vscode.Location[]> {
    try {
        const res = await vscode.commands.executeCommand(command, uri, new vscode.Position(line, col));
        if (!Array.isArray(res)) return [];
        return (res as vscode.Location[]).filter((l) => l instanceof vscode.Location);
    } catch {
        return [];
    }
}

function dedupeLocations(locations: vscode.Location[]): vscode.Location[] {
    const seen = new Set<string>();
    return locations.filter((l) => {
        const key = `${l.uri.toString()}:${l.range.start.line}:${l.range.start.character}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

async function parsedFor(uri: vscode.Uri): Promise<{ classes: ClassInfo[]; defs: DefInfo[] }> {
    const doc = await vscode.workspace.openTextDocument(uri);
    return cached(`${uri.toString()}#v${doc.version}#parse`, () => Promise.resolve((() => {
        const text = doc.getText();
        return { classes: findClasses(text), defs: findDefs(text) };
    })()));
}

/**
 * subclasses and overriding methods via the references provider (pyright's
 * implementation provider returns nothing in practice): a reference that lands
 * on a base-class position declares a subclass, one that lands on a def name
 * declares an override; imports and call sites fall through the filter
 */
async function queryChildren(uri: vscode.Uri, line: number, col: number): Promise<vscode.Location[]> {
    const doc = await docFor(uri);
    return cachedLocations(`${uri.toString()}#v${doc.version}#children:${line}:${col}`, async () => {
        const refs = await queryLocations('vscode.executeReferenceProvider', uri, line, col);
        const found: vscode.Location[] = [];
        for (const ref of refs) {
            const isSelfAnchor = ref.uri.toString() === uri.toString() && ref.range.start.line === line && ref.range.start.character === col;
            if (isSelfAnchor) continue;
            const parsed = await parsedFor(ref.uri);
            const cls = classForBaseAt(parsed.classes, ref.range.start.line, ref.range.start.character);
            if (cls !== null) {
                found.push(new vscode.Location(ref.uri, new vscode.Range(cls.line, cls.nameCol, cls.line, cls.nameCol + cls.name.length)));
                continue;
            }
            const def = defForNameAt(parsed.defs, ref.range.start.line, ref.range.start.character);
            if (def !== null) {
                found.push(new vscode.Location(ref.uri, new vscode.Range(def.line, def.nameCol, def.line, def.nameCol + def.name.length)));
            }
        }
        return dedupeLocations(found);
    });
}

async function queryParentClass(uri: vscode.Uri, line: number, col: number): Promise<vscode.Location[]> {
    const doc = await docFor(uri);
    return cachedLocations(`${uri.toString()}#v${doc.version}#type:${line}:${col}`, async () => {
        const all = await queryLocations('vscode.executeTypeDefinitionProvider', uri, line, col);
        return dedupeLocations(all.filter((l) => !(l.uri.toString() === uri.toString() && l.range.start.line === line)));
    });
}

/**
 * the next definer of methodName up the base chain, MRO-style: bases in
 * declaration order, first defining class wins, a base without its own def
 * is skipped in favor of its own ancestors (what super() resolves to).
 * Declaration-order DFS approximates the C3 merge everywhere but exotic
 * diamonds.
 */
async function nextMethodDefiner(classNode: NavNode, methodName: string, seen: Set<string>): Promise<NavNode | null> {
    const key = nodeKey(classNode);
    if (seen.has(key)) return null;
    seen.add(key);
    const parsed = await parsedFor(classNode.uri);
    const cls = classForLine(parsed.classes, classNode.line);
    for (const base of cls?.bases ?? []) {
        for (const loc of await queryParentClass(classNode.uri, base.line, base.col)) {
            const baseNode = await nodeForLocation(loc);
            if (baseNode === null) continue;
            const baseParsed = await parsedFor(baseNode.uri);
            const def = defOfNameInClass(baseParsed.defs, baseNode.label, methodName);
            if (def !== null) {
                return {
                    label: `${baseNode.label}.${def.name}`,
                    symbolName: def.name,
                    kind: 'method',
                    uri: baseNode.uri,
                    line: def.line,
                    nameCol: def.nameCol,
                    hasBases: (classForLine(baseParsed.classes, baseNode.line)?.bases.length ?? 0) > 0,
                };
            }
            const deeper = await nextMethodDefiner(baseNode, methodName, seen);
            if (deeper !== null) return deeper;
        }
    }
    return null;
}

async function jump(location: vscode.Location): Promise<void> {
    const doc = await vscode.workspace.openTextDocument(location.uri);
    await vscode.window.showTextDocument(doc, { selection: location.range, preview: true });
}

/** a node of the inheritance graph; also the unit sent to places */
interface NavNode {
    /** display label, e.g. `Class.method` for overrides */
    label: string;
    /** the bare symbol name the range points at */
    symbolName: string;
    kind: 'class' | 'method';
    uri: vscode.Uri;
    line: number;
    nameCol: number;
    /** whether the parents direction can start from this node (its class has bases) */
    hasBases: boolean;
}

function nodeRange(node: NavNode): vscode.Range {
    return new vscode.Range(node.line, node.nameCol, node.line, node.nameCol + node.symbolName.length);
}

function nodeKey(node: NavNode): string {
    return `${node.uri.toString()}:${node.line}`;
}

/** the class that owns the def declared at line, nearest above it */
function owningClass(parsed: { classes: ClassInfo[]; defs: DefInfo[] }, line: number): ClassInfo | null {
    const def = defForLine(parsed.defs, line);
    if (def === null || def.ownerClass === null) return null;
    return parsed.classes
        .filter((c) => c.name === def.ownerClass && c.line < line)
        .sort((a, b) => b.line - a.line)[0] ?? null;
}

async function nodeForLocation(loc: vscode.Location): Promise<NavNode | null> {
    const parsed = await parsedFor(loc.uri);
    const cls = classForLine(parsed.classes, loc.range.start.line);
    if (cls !== null) {
        return { label: cls.name, symbolName: cls.name, kind: 'class', uri: loc.uri, line: cls.line, nameCol: cls.nameCol, hasBases: cls.bases.length > 0 };
    }
    const def = defForLine(parsed.defs, loc.range.start.line);
    if (def !== null) {
        const owner = owningClass(parsed, def.line);
        return {
            label: owner !== null ? `${owner.name}.${def.name}` : def.name,
            symbolName: def.name,
            kind: 'method',
            uri: loc.uri,
            line: def.line,
            nameCol: def.nameCol,
            hasBases: (owner?.bases.length ?? 0) > 0,
        };
    }
    return null;
}

function dedupeNodes(nodes: NavNode[]): NavNode[] {
    const seen = new Set<string>();
    return nodes.filter((n) => {
        const key = `${n.uri.toString()}:${n.line}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/**
 * for a method: exactly one target — the MRO-style next definer up the base
 * chain (so ⇧ never needs a picker). For a class: its direct bases, which a
 * diamond can legitimately multiply.
 */
async function parentNodes(node: NavNode): Promise<NavNode[]> {
    if (node.kind === 'method') {
        const parsed = await parsedFor(node.uri);
        const owner = owningClass(parsed, node.line);
        if (owner === null) return [];
        const ownerNode: NavNode = {
            label: owner.name,
            symbolName: owner.name,
            kind: 'class',
            uri: node.uri,
            line: owner.line,
            nameCol: owner.nameCol,
            hasBases: owner.bases.length > 0,
        };
        const next = await nextMethodDefiner(ownerNode, node.symbolName, new Set());
        return next === null ? [] : [next];
    }
    const parsed = await parsedFor(node.uri);
    const cls = classForLine(parsed.classes, node.line);
    const nodes: NavNode[] = [];
    for (const base of cls?.bases ?? []) {
        for (const loc of await queryParentClass(node.uri, base.line, base.col)) {
            const parent = await nodeForLocation(loc);
            if (parent !== null) nodes.push(parent);
        }
    }
    return dedupeNodes(nodes);
}

/** direct subclasses of a class node */
async function classChildren(node: NavNode): Promise<NavNode[]> {
    const nodes: NavNode[] = [];
    for (const loc of await queryChildren(node.uri, node.line, node.nameCol)) {
        const child = await nodeForLocation(loc);
        if (child !== null) nodes.push(child);
    }
    return dedupeNodes(nodes).slice(0, MAX_TREE_CHILDREN);
}

/**
 * method overrides found structurally: pyright's references do not include
 * override declarations, so walk the owner's subclasses looking for a def with
 * the same name. Subclasses without their own def are transparent: their
 * subclasses' overrides are promoted to this level, and a subtree with no
 * override anywhere contributes nothing — a method hierarchy shows only real
 * overrides. `seen` breaks subclass cycles across the whole level.
 */
async function overridesInSubclasses(classNode: NavNode, methodName: string, seen: Set<string>): Promise<NavNode[]> {
    const nodes: NavNode[] = [];
    for (const sub of await classChildren(classNode)) {
        const key = nodeKey(sub);
        if (seen.has(key)) continue;
        seen.add(key);
        const parsed = await parsedFor(sub.uri);
        const override = defOfNameInClass(parsed.defs, sub.label, methodName);
        if (override !== null) {
            nodes.push({
                label: `${sub.label}.${override.name}`,
                symbolName: override.name,
                kind: 'method',
                uri: sub.uri,
                line: override.line,
                nameCol: override.nameCol,
                hasBases: (classForLine(parsed.classes, sub.line)?.bases.length ?? 0) > 0,
            });
        } else {
            nodes.push(...await overridesInSubclasses(sub, methodName, seen));
        }
    }
    return dedupeNodes(nodes);
}

/** children of a node in the ⇩ direction */
async function childNodes(node: NavNode): Promise<NavNode[]> {
    if (node.kind === 'method') {
        const parsed = await parsedFor(node.uri);
        const owner = owningClass(parsed, node.line);
        if (owner === null) return [];
        const ownerNode: NavNode = {
            label: owner.name,
            symbolName: owner.name,
            kind: 'class',
            uri: node.uri,
            line: owner.line,
            nameCol: owner.nameCol,
            hasBases: owner.bases.length > 0,
        };
        return overridesInSubclasses(ownerNode, node.symbolName, new Set());
    }
    return classChildren(node);
}

const MAX_TREE_NODES = 100;

/** the payload item shape of the places.addGroup command */
interface PlaceItemOut {
    label: string;
    detail?: string;
    uri: string;
    line: number;
    character: number;
    children?: PlaceItemOut[];
    contextValue?: 'kindRoot' | 'synthetic';
}

const keyOfNode = (n: NavNode): string => `${n.uri.toString()}:${n.line}:${n.nameCol}`;

function toItem(branch: WalkBranch<NavNode>): PlaceItemOut {
    return {
        label: branch.node.label,
        detail: `${path.basename(branch.node.uri.fsPath)}:${branch.node.line + 1}`,
        uri: branch.node.uri.toString(),
        line: branch.node.line,
        character: branch.node.nameCol,
        children: branch.children.length === 0 ? undefined : branch.children.map(toItem),
    };
}

/** native peek (the cmd-click usages / git-gutter widget) with a custom target list */
async function peekTargets(uri: vscode.Uri, position: vscode.Position, nodes: NavNode[]): Promise<void> {
    // positional args, matching the handler signature in the workbench bundle;
    // the object form fails the URI constraint and silently does nothing.
    // multiple: 'peek' | 'gotoAndPeek' | 'goto'
    await vscode.commands.executeCommand(
        'editor.action.peekLocations',
        uri,
        position,
        nodes.map((n) => new vscode.Location(n.uri, nodeRange(n))),
        'peek',
    );
}

/**
 * ⇅ collects the whole hierarchy into a result editor. ⇧/⇩ are quick
 * navigation, never an editor: a single direct parent/child jumps straight
 * there, several open the native peek to pick the target from
 */
async function runNav(raw: unknown): Promise<void> {
    const args = parseNavArgs(raw);
    if (args === null) {
        void vscode.window.showWarningMessage('py-hierarchy: bad navigation arguments');
        return;
    }
    const uri = vscode.Uri.parse(args.uri);
    const parsed = await parsedFor(uri);
    const cls = classForLine(parsed.classes, args.line);
    const def = cls === null ? defForLine(parsed.defs, args.line) : null;
    if (cls === null && def === null) {
        void vscode.window.showWarningMessage('py-hierarchy: no class or method at the anchor line');
        return;
    }
    const owner = cls === null ? owningClass(parsed, def!.line) : null;
    const root: NavNode = cls !== null
        ? { label: cls.name, symbolName: cls.name, kind: 'class', uri, line: cls.line, nameCol: cls.nameCol, hasBases: cls.bases.length > 0 }
        : {
            // `Owner.method`, same as LSP-discovered nodes: group titles stay
            // unambiguous ("⇅ init" would be meaningless)
            label: owner !== null ? `${owner.name}.${def!.name}` : def!.name,
            symbolName: def!.name,
            kind: 'method',
            uri,
            line: def!.line,
            nameCol: def!.nameCol,
            hasBases: (owner?.bases.length ?? 0) > 0,
        };
    // the root's parents get one guarded re-query: a cold server answers []
    // once and cachedLocations keeps that empty answer for 1.2s, which would
    // silently drop the whole ⇧ section
    let rootParents: NavNode[] | null = null;
    const queries: WalkQueries<NavNode> = {
        children: childNodes,
        parents: async (node) => {
            if (node !== root) return parentNodes(node);
            if (rootParents === null) {
                rootParents = await parentNodes(root);
                if (rootParents.length === 0 && root.hasBases) {
                    await new Promise((resolve) => setTimeout(resolve, 1500));
                    rootParents = await parentNodes(root);
                }
            }
            return rootParents;
        },
    };
    let title: string;
    let items: PlaceItemOut[];
    let truncated: boolean;
    if (args.kind === 'both') {
        // ⇅ is the explicit full-picture click: always the result editor
        // canonical orientation: present the hierarchy from the chain top so a
        // ⇅ click on any member builds the same group (frontik → k-meta from
        // either side). Without a single top (diamond, cap) fall back to the
        // root's own view, parents and children flat, no synthetic nodes.
        const both = await collectBoth(queries, root, keyOfNode, MAX_TREE_NODES);
        const tops = both.parents.filter((p) => p.children.length === 0).map((p) => p.node);
        if (!both.truncated && tops.length === 1) {
            const top = tops[0];
            const down = await collectTree(queries, top, keyOfNode, 'children', MAX_TREE_NODES);
            title = `⇅ ${top.label}`;
            // the top itself heads the tree — without it the anchor has nothing
            // to indent against and the lineage reads as a flat sibling list
            items = [toItem({ node: top, children: down.branches })];
            truncated = down.truncated;
        } else {
            title = `⇅ ${root.label}`;
            items = splitByDirection({ node: root, children: [] }, both.parents, both.children, toItem);
            truncated = both.truncated;
        }
    } else {
        const res = await collectTree(queries, root, keyOfNode, args.kind, MAX_TREE_NODES);
        const directs = res.branches.map((b) => b.node);
        if (directs.length === 0) {
            void vscode.window.showInformationMessage(
                args.kind === 'parents' ? 'py-hierarchy: no parents found' : 'py-hierarchy: no children found',
            );
            return;
        }
        if (directs.length === 1) {
            await jump(new vscode.Location(directs[0].uri, nodeRange(directs[0])));
            return;
        }
        await peekTargets(uri, new vscode.Position(args.line, args.col), directs);
        return;
    }
    if (items.length === 0) {
        void vscode.window.showInformationMessage('py-hierarchy: nothing found');
        return;
    }
    await openResultEditor(title, items, truncated, RESULT_DOC);
}

interface Anchor {
    kind: 'class' | 'method';
    name: string;
    line: number;
    nameCol: number;
    ownerClass: string | null;
    bases: ClassInfo['bases'];
}

interface AnchorLink {
    title: string;
    args: NavArgs;
}

/** ⇅ first (leftmost), then ⇩ and ⇧; each collects the whole tree into places */
async function anchorLinks(uri: vscode.Uri, anchor: Anchor): Promise<AnchorLink[]> {
    const uriStr = uri.toString();
    const links: AnchorLink[] = [];
    const node: NavNode = {
        label: anchor.name,
        symbolName: anchor.name,
        kind: anchor.kind,
        uri,
        line: anchor.line,
        nameCol: anchor.nameCol,
        hasBases: anchor.bases.length > 0,
    };
    const children = await childNodes(node);
    const hasChildren = children.length > 0;
    const parents = await parentNodes(node);
    if (hasChildren || parents.length > 0) {
        links.push({ title: bothTitle(), args: { kind: 'both', uri: uriStr, line: anchor.line, col: anchor.nameCol } });
    }
    if (hasChildren) {
        links.push({ title: childrenTitle(), args: { kind: 'children', uri: uriStr, line: anchor.line, col: anchor.nameCol } });
    }
    if (parents.length > 0) {
        links.push({ title: parentTitle(), args: { kind: 'parents', uri: uriStr, line: anchor.line, col: anchor.nameCol } });
    }
    return links;
}

function visibleLineSet(editor: vscode.TextEditor): Set<number> {
    const lines = new Set<number>();
    for (const range of editor.visibleRanges) {
        for (let l = Math.max(0, range.start.line - VISIBLE_MARGIN_LINES); l <= range.end.line + VISIBLE_MARGIN_LINES; l++) {
            lines.add(l);
        }
    }
    return lines;
}

function collectAnchors(classes: ClassInfo[], defs: DefInfo[], visible: Set<number> | null, cap: number): Anchor[] {
    const anchors: Anchor[] = [];
    for (const c of classes) {
        if (visible === null || visible.has(c.line)) {
            anchors.push({ kind: 'class', name: c.name, line: c.line, nameCol: c.nameCol, ownerClass: null, bases: c.bases });
        }
    }
    for (const d of defs) {
        if (d.ownerClass !== null && (visible === null || visible.has(d.line))) {
            anchors.push({ kind: 'method', name: d.name, line: d.line, nameCol: d.nameCol, ownerClass: d.ownerClass, bases: [] });
        }
    }
    return anchors.sort((a, b) => a.line - b.line).slice(0, cap);
}

const pendingTimers = new Map<vscode.TextEditor, ReturnType<typeof setTimeout>>();
const passTokens = new Map<vscode.TextEditor, number>();

function scheduleDecorate(editor: vscode.TextEditor | undefined): void {
    if (editor === undefined) return;
    const timer = pendingTimers.get(editor);
    if (timer !== undefined) clearTimeout(timer);
    pendingTimers.set(editor, setTimeout(() => void decorate(editor), DEBOUNCE_MS));
}

async function decorate(editor: vscode.TextEditor): Promise<void> {
    if (editor.document.languageId !== 'python') {
        editor.setDecorations(gutterUp, []);
        editor.setDecorations(gutterDown, []);
        editor.setDecorations(gutterBoth, []);
        return;
    }
    const token = (passTokens.get(editor) ?? 0) + 1;
    passTokens.set(editor, token);
    const doc = editor.document;
    const classes = findClasses(doc.getText());
    const defs = findDefs(doc.getText());
    const anchors = collectAnchors(classes, defs, visibleLineSet(editor), MAX_ANCHORS_PER_PASS);

    const up: vscode.Range[] = [];
    const down: vscode.Range[] = [];
    const both: vscode.Range[] = [];
    for (const anchor of anchors) {
        const links = await anchorLinks(doc.uri, anchor);
        if (passTokens.get(editor) !== token) return;
        if (links.length === 0) continue;
        const range = doc.lineAt(anchor.line).range;
        const hasChildren = links.some((l) => l.args.kind === 'children');
        const hasParents = links.some((l) => l.args.kind === 'parents');
        if (hasChildren && hasParents) both.push(range);
        else if (hasChildren) down.push(range);
        else if (hasParents) up.push(range);
    }
    if (passTokens.get(editor) !== token) return;
    editor.setDecorations(gutterUp, up);
    editor.setDecorations(gutterDown, down);
    editor.setDecorations(gutterBoth, both);
}

class OverrideCodeLensProvider implements vscode.CodeLensProvider {
    readonly #change = new vscode.EventEmitter<void>();
    readonly onDidChangeCodeLenses = this.#change.event;
    readonly #coldAttempts = new Map<string, number>();

    provideCodeLenses(document: vscode.TextDocument): vscode.ProviderResult<vscode.CodeLens[]> {
        if (document.languageId !== 'python' || document.uri.scheme !== 'file') return [];
        const text = document.getText();
        const anchors = collectAnchors(findClasses(text), findDefs(text), null, MAX_ANCHORS_PER_LENS);
        return (async () => {
            const lenses: vscode.CodeLens[] = [];
            let linksFound = 0;
            for (const anchor of anchors) {
                for (const link of await anchorLinks(document.uri, anchor)) {
                    linksFound += 1;
                    const range = new vscode.Range(anchor.line, 0, anchor.line, 0);
                    lenses.push(new vscode.CodeLens(range, { title: link.title, command: NAV_COMMAND, arguments: [link.args] }));
                }
            }
            this.#retryCold(document.uri, anchors.length, linksFound);
            return lenses;
        })();
    }

    /**
     * a cold server answers [] for every query and the lenses would stay
     * missing until the next edit; keep re-asking, densely at first
     */
    #retryCold(uri: vscode.Uri, anchorCount: number, linksFound: number): void {
        const key = uri.toString();
        if (linksFound > 0 || anchorCount === 0) {
            this.#coldAttempts.delete(key);
            return;
        }
        const attempt = (this.#coldAttempts.get(key) ?? 0) + 1;
        const delay = COLD_RETRY_DELAYS_MS[attempt - 1];
        if (delay === undefined) return;
        this.#coldAttempts.set(key, attempt);
        setTimeout(() => {
            this.#change.fire();
            for (const editor of vscode.window.visibleTextEditors) {
                if (editor.document.uri.toString() === key) scheduleDecorate(editor);
            }
        }, delay);
    }
}

export function activate(context: vscode.ExtensionContext): void {
    const media = (name: string): vscode.Uri => vscode.Uri.file(context.asAbsolutePath(path.join('media', name)));
    gutterUp = vscode.window.createTextEditorDecorationType({ gutterIconPath: media('gutter-up.svg'), gutterIconSize: 'contain' });
    gutterDown = vscode.window.createTextEditorDecorationType({ gutterIconPath: media('gutter-down.svg'), gutterIconSize: 'contain' });
    gutterBoth = vscode.window.createTextEditorDecorationType({ gutterIconPath: media('gutter-both.svg'), gutterIconSize: 'contain' });
    context.subscriptions.push(
        gutterUp,
        gutterDown,
        gutterBoth,
        vscode.commands.registerCommand(NAV_COMMAND, (raw: unknown) => void runNav(raw)),
        vscode.languages.registerCodeLensProvider(
            { language: 'python', scheme: 'file' },
            new OverrideCodeLensProvider(),
        ),
        vscode.window.onDidChangeActiveTextEditor(scheduleDecorate),
        vscode.window.onDidChangeTextEditorVisibleRanges((e) => scheduleDecorate(e.textEditor)),
        vscode.workspace.onDidChangeTextDocument((e) => {
            invalidateUri(e.document.uri);
            for (const editor of vscode.window.visibleTextEditors) {
                if (editor.document.uri.toString() === e.document.uri.toString()) scheduleDecorate(editor);
            }
        }),
        vscode.window.onDidChangeVisibleTextEditors((editors) => {
            for (const editor of [...pendingTimers.keys()]) {
                if (!editors.includes(editor)) {
                    clearTimeout(pendingTimers.get(editor));
                    pendingTimers.delete(editor);
                    passTokens.delete(editor);
                }
            }
        }),
    );
    registerResultDoc(context, RESULT_DOC);
    for (const editor of vscode.window.visibleTextEditors) scheduleDecorate(editor);
}
