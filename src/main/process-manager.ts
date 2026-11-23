import { spawn, type ChildProcess } from 'node:child_process';

// Every child process (cc65, ld65 from M2) runs with an argument array, no shell, a timeout, and is
// killed when the app quits (PLAN principle 8).
export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export class ProcessManager {
  private readonly live = new Set<ChildProcess>();

  run(cmd: string, args: string[], opts: { cwd?: string; timeoutMs?: number } = {}): Promise<RunResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(cmd, args, { cwd: opts.cwd, shell: false, windowsHide: true });
      this.live.add(child);
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, opts.timeoutMs ?? 60_000);
      child.stdout?.on('data', (d: Buffer) => (stdout += d.toString('utf8')));
      child.stderr?.on('data', (d: Buffer) => (stderr += d.toString('utf8')));
      child.on('error', (e) => {
        clearTimeout(timer);
        this.live.delete(child);
        reject(e);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        this.live.delete(child);
        resolve({ code, stdout, stderr, timedOut });
      });
    });
  }

  get count(): number {
    return this.live.size;
  }

  killAll(): void {
    for (const c of this.live) c.kill();
    this.live.clear();
  }
}
