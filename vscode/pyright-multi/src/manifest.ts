import * as path from 'node:path';
import { parse as parseJsonc, type ParseError } from 'jsonc-parser';

export interface ModuleEntry {
    /** absolute module root dir */
    root: string;
    /** absolute venv dir */
    venv: string;
}

export interface Manifest {
    modules: ModuleEntry[];
}

export class ManifestError extends Error {}

interface RawEntry {
    root?: unknown;
    venv?: unknown;
}

interface RawManifest {
    modules?: unknown;
}

export function parseManifest(text: string, manifestDir: string): Manifest {
    const errors: ParseError[] = [];
    const raw = parseJsonc(text, errors, { allowTrailingComma: true }) as RawManifest | null;
    if (errors.length > 0 || raw === null || typeof raw !== 'object') {
        throw new ManifestError('pyright-modules.json is not valid json');
    }
    if (!Array.isArray(raw.modules)) {
        throw new ManifestError('pyright-modules.json: "modules" must be an array');
    }
    const modules = raw.modules.map((item, i) => {
        const entry = item as RawEntry;
        if (typeof entry?.root !== 'string' || entry.root.length === 0) {
            throw new ManifestError(`modules[${i}]: "root" must be a non-empty string`);
        }
        if (entry.venv !== undefined && typeof entry.venv !== 'string') {
            throw new ManifestError(`modules[${i}]: "venv" must be a string`);
        }
        const root = path.resolve(manifestDir, entry.root);
        const venv = entry.venv === undefined ? path.join(root, '.venv') : path.resolve(manifestDir, entry.venv);
        return { root, venv };
    });
    return { modules };
}

export interface ReloadResult {
    ok: boolean;
    error: string | null;
}

export class ManifestStore {
    #manifest: Manifest | null;

    constructor(initial: Manifest | null) {
        this.#manifest = initial;
    }

    current(): Manifest | null {
        return this.#manifest;
    }

    reload(text: string, manifestDir: string): ReloadResult {
        try {
            this.#manifest = parseManifest(text, manifestDir);
            return { ok: true, error: null };
        } catch (e) {
            const error = e instanceof Error ? e.message : String(e);
            return { ok: false, error };
        }
    }
}
