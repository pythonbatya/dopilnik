export interface RemoteRepo {
    host: string;
    ownerRepo: string;
}

// 1-based, inclusive
export interface LineSpan {
    start: number;
    end: number;
}

export function parseRemote(url: string): RemoteRepo | undefined {
    // ssh://git@host[:port]/owner/repo(.git) | http(s)://host/owner/repo(.git)
    const full = url.match(/^(?:ssh|https?):\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+?)(?:\.git)?\/?$/);
    if (full) {
        return { host: full[1], ownerRepo: full[2] };
    }
    // scp-like: git@host:owner/repo(.git)
    const scp = url.match(/^[^@/]+@([^:/]+):(.+?)(?:\.git)?\/?$/);
    if (scp) {
        return { host: scp[1], ownerRepo: scp[2] };
    }
    return undefined;
}

export function buildWebUrl(remote: RemoteRepo, sha: string, relPath: string, span: LineSpan): string {
    const encodedPath = relPath.split('/').map(encodeURIComponent).join('/');
    const revPart = remote.host === 'github.com' ? `blob/${sha}` : `src/commit/${sha}`;
    const anchor = span.end > span.start ? `#L${span.start}-L${span.end}` : `#L${span.start}`;
    return `https://${remote.host}/${remote.ownerRepo}/${revPart}/${encodedPath}${anchor}`;
}

// vscode selection (0-based) -> 1-based line span; a selection ending at
// column 0 does not count its last line
export function selectedLineSpan(startLine: number, endLine: number, endCharacter: number): LineSpan {
    const lastLine = endLine > startLine && endCharacter === 0 ? endLine - 1 : endLine;
    return { start: startLine + 1, end: lastLine + 1 };
}
