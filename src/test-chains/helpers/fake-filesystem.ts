/**
 * In-memory filesystem double shared by the chain tests.
 *
 * Mirrors the injected-filesystem seams of the external-games scanners
 * (`HytaleScanFilesystem` / `DesktopEntryScanFilesystem`) so one fake can
 * back every builder. Paths are opaque strings: Windows fixtures use
 * backslash separators, Linux fixtures forward slashes, exactly like the
 * colocated unit tests do.
 */
import fs from "node:fs";

export interface FakeFilesystemLayout {
  /** Absolute paths of every directory that exists. */
  directories?: string[];
  /** Absolute path → contents. */
  files?: Record<string, string>;
}

export interface FakeFilesystem {
  existsSync(filePath: string): boolean;
  readFileSync(filePath: string, encoding: "utf8"): string;
  readdirSync(dirPath: string): string[];
  statSync(targetPath: string): { isDirectory(): boolean };
}

export const createFakeFilesystem = (
  layout: FakeFilesystemLayout
): FakeFilesystem => {
  const directories = new Set(layout.directories ?? []);
  const files = new Map(Object.entries(layout.files ?? {}));

  return {
    existsSync: (targetPath) =>
      directories.has(targetPath) || files.has(targetPath),
    readFileSync: (targetPath) => {
      const contents = files.get(targetPath);
      if (contents === undefined) {
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      }
      return contents;
    },
    readdirSync: (dirPath) => {
      if (!directories.has(dirPath)) {
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      }
      const separator = dirPath.includes("\\") ? "\\" : "/";
      const prefix = dirPath.endsWith(separator)
        ? dirPath
        : dirPath + separator;
      const children = new Set<string>();
      for (const directory of directories) {
        if (!directory.startsWith(prefix)) continue;
        const remainder = directory.slice(prefix.length);
        if (remainder) children.add(remainder.split(/[\\/]/)[0]);
      }
      for (const file of files.keys()) {
        if (!file.startsWith(prefix)) continue;
        const remainder = file.slice(prefix.length);
        if (remainder) children.add(remainder.split(/[\\/]/)[0]);
      }
      return [...children];
    },
    statSync: (targetPath) => ({
      isDirectory: () => directories.has(targetPath),
    }),
  };
};

/** Node fs adapter conforming to the scanners' injected-filesystem seams. */
export const createRealFilesystem = (): FakeFilesystem => ({
  existsSync: (filePath) => fs.existsSync(filePath),
  readFileSync: (filePath, encoding) => fs.readFileSync(filePath, encoding),
  readdirSync: (dirPath) => fs.readdirSync(dirPath),
  statSync: (targetPath) => fs.statSync(targetPath),
});
