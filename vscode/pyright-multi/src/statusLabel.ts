import * as path from 'node:path';

/** short status-bar label for the module owning the active file: `py: k-meta` or `py: None` */
export function pyStatusLabel(root: string | null): string {
    return root === null ? 'py: None' : `py: ${path.basename(root)}`;
}
