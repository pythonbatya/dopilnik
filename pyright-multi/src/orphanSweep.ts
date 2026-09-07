import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

export interface PsLine {
    pid: string;
    ppid: string;
    command: string;
}

export function parsePs(output: string): PsLine[] {
    return output
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith('PID'))
        .map((line) => {
            const parts = line.split(/\s+/);
            return { pid: parts[0], ppid: parts[1], command: parts.slice(2).join(' ') };
        });
}

export function selectOrphans(lines: ReadonlyArray<PsLine>, ourLangserverPath: string): number[] {
    return lines
        .filter((l) => l.command.includes(ourLangserverPath) && l.ppid === '1')
        .map((l) => Number(l.pid))
        .filter((pid) => Number.isInteger(pid) && pid > 0);
}

export async function sweepOrphans(ourLangserverPath: string): Promise<number[]> {
    const { stdout } = await execFileP('ps', ['-axo', 'pid=,ppid=,command=']);
    const victims = selectOrphans(parsePs(stdout), ourLangserverPath);
    for (const pid of victims) {
        try {
            process.kill(pid, 'SIGKILL');
        } catch {
            // already gone — nothing to do
        }
    }
    return victims;
}
