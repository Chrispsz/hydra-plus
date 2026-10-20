import type { ChildProcess } from "node:child_process";

/**
 * Registry of currently running extraction children (F1 stability fix),
 * extracted verbatim from 7zip.ts so the POSIX process-group kill can be
 * chained against real detached processes without Electron.
 */
export class ChildProcessRegistry {
  /** Handles of currently running extractions, so quit/cancel can stop them. */
  private readonly children = new Set<ChildProcess>();

  public add(child: ChildProcess): void {
    this.children.add(child);
  }

  public remove(child: ChildProcess): void {
    this.children.delete(child);
  }

  public get size(): number {
    return this.children.size;
  }

  public cancelAll(): void {
    if (this.children.size === 0) return;

    for (const child of this.children) {
      try {
        // Extraction children are spawned detached; on POSIX kill the whole
        // process group so the 7z child cannot survive the app quit.
        if (process.platform !== "win32" && child.pid) {
          try {
            process.kill(-child.pid);
          } catch {
            child.kill();
          }
        } else {
          child.kill();
        }
      } catch {
        // Already gone.
      }
    }

    this.children.clear();
  }
}
