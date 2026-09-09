import type { Manifest, ModuleEntry } from './manifest';

export interface ManifestDiff {
    added: ModuleEntry[];
    removed: ModuleEntry[];
}

function sameModule(a: ModuleEntry, b: ModuleEntry): boolean {
    return a.root === b.root && a.venv === b.venv;
}

export function diffManifests(old: Manifest | null, current: Manifest): ManifestDiff {
    const oldModules = old?.modules ?? [];
    return {
        added: current.modules.filter((m) => !oldModules.some((o) => sameModule(o, m))),
        removed: oldModules.filter((m) => !current.modules.some((o) => sameModule(o, m))),
    };
}
