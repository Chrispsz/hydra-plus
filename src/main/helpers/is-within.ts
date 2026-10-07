import path from "node:path";
import fs from "node:fs";

/**
 * True when `target` is `root` itself or lives anywhere inside `root`.
 * Symlink-aware: both sides are resolved to their real path when they exist,
 * so a symlinked games library is still contained under its declared root.
 */
export const isWithin = (target: string, root: string): boolean => {
  const resolve = (p: string): string => {
    try {
      return fs.realpathSync.native(p);
    } catch {
      return path.resolve(p);
    }
  };

  const resolvedTarget = resolve(target);
  const resolvedRoot = resolve(root);

  const rel = path.relative(resolvedRoot, resolvedTarget);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
};
