import { BrowserWindow, app, safeStorage } from "electron";
import log from "electron-log";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { logsPath, IS_DEBUG_BUILD } from "@main/constants";
import icon from "@resources/icon.png?asset";
import { networkLog } from "./logger";
import { Umu } from "./umu";
import { getSteamLibraryFolders } from "./steam";

export interface DebugLogEntry {
  seq: number;
  ts: string;
  level: "debug" | "info" | "warn" | "error";
  scope: string;
  message: string;
  data?: string;
}

const MAX_BUFFER_SIZE = 4000;
const MAX_SERIALIZED_LENGTH = 12_000;
const DEBUG_SESSION_FILE = "debug-session.log";

const LEVEL_LABEL: Record<string, DebugLogEntry["level"]> = {
  debug: "debug",
  verbose: "debug",
  info: "info",
  log: "info",
  warn: "warn",
  warning: "warn",
  error: "error",
};

const serializeValue = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (value instanceof Error) {
    return `${value.name}: ${value.message}${
      value.stack ? `\n${value.stack}` : ""
    }`;
  }
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    try {
      return String(value);
    } catch {
      return "[unserializable]";
    }
  }
};

export class DebugConsole {
  private static buffer: DebugLogEntry[] = [];
  private static seq = 0;
  private static debugWindow: BrowserWindow | null = null;
  private static attached = false;

  private static get sessionFilePath() {
    return path.join(logsPath, DEBUG_SESSION_FILE);
  }

  public static record(
    level: DebugLogEntry["level"],
    scope: string,
    message: string,
    data?: unknown
  ): void {
    try {
      const entry: DebugLogEntry = {
        seq: ++this.seq,
        ts: new Date().toISOString(),
        level,
        scope: scope || "main",
        message:
          message.length > MAX_SERIALIZED_LENGTH
            ? `${message.slice(0, MAX_SERIALIZED_LENGTH)}…[truncated]`
            : message,
      };

      if (data !== undefined && data !== null) {
        const serialized = serializeValue(data);
        if (serialized.length > 0) {
          entry.data =
            serialized.length > MAX_SERIALIZED_LENGTH
              ? `${serialized.slice(0, MAX_SERIALIZED_LENGTH)}…[truncated]`
              : serialized;
        }
      }

      this.buffer.push(entry);
      if (this.buffer.length > MAX_BUFFER_SIZE) {
        this.buffer.splice(0, this.buffer.length - MAX_BUFFER_SIZE);
      }

      this.appendToSessionFile(entry);
      this.broadcast(entry);
    } catch {
      // The debug console must never break the app.
    }
  }

  public static getBuffer(): DebugLogEntry[] {
    return [...this.buffer];
  }

  public static clear(): void {
    this.buffer = [];
  }

  public static isOpen(): boolean {
    return this.debugWindow !== null && !this.debugWindow.isDestroyed();
  }

  public static openWindow(): void {
    if (this.isOpen()) {
      this.debugWindow?.focus();
      return;
    }

    const window = new BrowserWindow({
      width: 1020,
      height: 760,
      minWidth: 640,
      minHeight: 440,
      title: "Hydra Plus — Console de Debug",
      icon,
      backgroundColor: "#111318",
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, "../preload/index.mjs"),
        contextIsolation: true,
        nodeIntegration: false,
        webviewTag: false,
      },
    });

    this.debugWindow = window;
    window.on("closed", () => {
      this.debugWindow = null;
    });

    if (process.env["ELECTRON_RENDERER_URL"]) {
      window.loadURL(
        `${process.env["ELECTRON_RENDERER_URL"]}/debug/index.html`
      );
    } else {
      window.loadFile(path.join(__dirname, "../renderer/debug/index.html"));
    }
  }

  public static toggleWindow(): void {
    if (this.isOpen()) {
      this.debugWindow?.close();
      return;
    }
    this.openWindow();
  }

  public static closeWindow(): void {
    if (this.isOpen()) {
      this.debugWindow?.close();
    }
  }

  public static async exportLog(): Promise<{ path: string; count: number }> {
    const exportPath = path.join(
      logsPath,
      `debug-export-${new Date().toISOString().replace(/[:.]/g, "-")}.log`
    );

    const content = this.buffer
      .map((entry) => {
        const dataPart = entry.data ? `\n    ${entry.data}` : "";
        return `[${entry.ts}] [${entry.level.toUpperCase()}] [${entry.scope}] ${entry.message}${dataPart}`;
      })
      .join("\n");

    fs.mkdirSync(logsPath, { recursive: true });
    fs.writeFileSync(exportPath, `${content}\n`, "utf8");

    this.record("info", "debug-console", "Log exportado", {
      exportPath,
      count: this.buffer.length,
    });

    return { path: exportPath, count: this.buffer.length };
  }

  public static async collectEnvironmentSnapshot(): Promise<
    Record<string, unknown>
  > {
    const snapshot: Record<string, unknown> = {
      app: {
        version: app.getVersion(),
        isPackaged: app.isPackaged,
        isDebugBuild: IS_DEBUG_BUILD,
        userDataPath: app.getPath("userData"),
        logsPath,
        crashDumpsPath: app.getPath("crashDumps"),
        execPath: process.execPath,
      },
      system: {
        platform: process.platform,
        arch: process.arch,
        osType: os.type(),
        osRelease: os.release(),
        cpuModel: os.cpus()[0]?.model ?? "unknown",
        totalMemoryGB: Number((os.totalmem() / 1024 ** 3).toFixed(2)),
        freeMemoryGB: Number((os.freemem() / 1024 ** 3).toFixed(2)),
        uptimeHours: Number((os.uptime() / 3600).toFixed(2)),
      },
      environment: {
        XDG_SESSION_TYPE: process.env.XDG_SESSION_TYPE ?? null,
        WAYLAND_DISPLAY: process.env.WAYLAND_DISPLAY ?? null,
        DISPLAY: process.env.DISPLAY ?? null,
        XDG_CURRENT_DESKTOP: process.env.XDG_CURRENT_DESKTOP ?? null,
        DESKTOP_SESSION: process.env.DESKTOP_SESSION ?? null,
        PATH_has_flatpak: Boolean(process.env.FLATPAK_ID),
        SNAP: process.env.SNAP_NAME ?? null,
      },
      electron: {
        electronVersion: process.versions.electron,
        chromeVersion: process.versions.chrome,
        nodeVersion: process.versions.node,
        safeStorageAvailable: safeStorage.isEncryptionAvailable(),
      },
    };

    if (process.platform === "linux") {
      snapshot.linux = {
        python3: this.probePython3(),
        umu: this.probeUmu(),
        steam: await this.probeSteam(),
      };
    }

    this.record("info", "debug-console", "Snapshot de ambiente coletado");
    return snapshot;
  }

  public static attach(): void {
    if (this.attached) return;
    this.attached = true;

    try {
      fs.mkdirSync(logsPath, { recursive: true });
      fs.writeFileSync(
        this.sessionFilePath,
        `=== Hydra Plus debug session started at ${new Date().toISOString()} (debug build: ${IS_DEBUG_BUILD}) ===\n`
      );
    } catch {
      // Ignore file system issues; the in-memory buffer still works.
    }

    const electronLogHook = (logMessage: log.LogMessage) => {
      const [first, ...rest] = logMessage.data ?? [];
      const message = serializeValue(first ?? "");
      const extra =
        rest.length > 0
          ? rest.map((item) => serializeValue(item)).join("\n")
          : undefined;
      this.record(
        LEVEL_LABEL[logMessage.level] ?? "info",
        logMessage.scope ?? "main",
        message,
        extra
      );
      return logMessage;
    };

    try {
      log.hooks.push(electronLogHook);
      networkLog.hooks.push(electronLogHook);
    } catch {
      // Hooking failures must never break logging.
    }

    app.on("web-contents-created", (_event, contents) => {
      if (contents.getType() !== "window") return;

      contents.on(
        "console-message",
        (
          event: unknown,
          legacyLevel?: unknown,
          legacyMessage?: unknown,
          legacySource?: unknown
        ) => {
          const anyEvent = event as
            | (Electron.Event & {
                level?: unknown;
                message?: unknown;
                sourceId?: unknown;
              })
            | undefined;

          const params =
            anyEvent && anyEvent.message !== undefined
              ? {
                  level: anyEvent.level,
                  message: anyEvent.message,
                  sourceId: anyEvent.sourceId,
                }
              : {
                  level: legacyLevel,
                  message: legacyMessage,
                  sourceId: legacySource,
                };

          if (contents === this.debugWindow?.webContents) return;

          const rawLevel = String(params.level ?? "info");
          const numericLevel = Number(rawLevel);
          const levelName = Number.isFinite(numericLevel)
            ? (["verbose", "info", "warning", "error"][numericLevel] ?? "info")
            : rawLevel;

          this.record(
            LEVEL_LABEL[levelName] ?? "info",
            "renderer-console",
            String(params.message ?? ""),
            params.sourceId ? String(params.sourceId) : undefined
          );
        }
      );
    });

    app.on("child-process-gone", (_event, details) => {
      this.record("error", "process", "Child process gone", {
        type: details.type,
        reason: details.reason,
        exitCode: details.exitCode,
        serviceName: details.serviceName,
        name: details.name,
      });
    });

    app.on("render-process-gone", (_event, webContents, details) => {
      this.record("error", "process", "Render process gone", {
        reason: details.reason,
        exitCode: details.exitCode,
        windowTitle: webContents.getTitle(),
      });
    });

    this.record("info", "debug-console", "Debug console attached", {
      sessionFile: this.sessionFilePath,
      platform: process.platform,
      appVersion: app.getVersion(),
    });
  }

  private static broadcast(entry: DebugLogEntry): void {
    const window = this.debugWindow;
    if (!window || window.isDestroyed()) return;
    try {
      window.webContents.send("debug-console:new-log", entry);
    } catch {
      // Ignore send failures (window closing races).
    }
  }

  private static appendToSessionFile(entry: DebugLogEntry): void {
    try {
      const dataPart = entry.data ? `\n    ${entry.data}` : "";
      fs.appendFileSync(
        this.sessionFilePath,
        `[${entry.ts}] [${entry.level.toUpperCase()}] [${entry.scope}] ${entry.message}${dataPart}\n`
      );
    } catch {
      // Ignore.
    }
  }

  private static probePython3(): Record<string, unknown> {
    try {
      const result = spawnSync(
        "python3",
        ["-c", "import sys; print(sys.version.split()[0])"],
        { encoding: "utf8", timeout: 5000 }
      );
      return {
        available: result.status === 0,
        version: result.stdout?.trim() ?? null,
      };
    } catch (error) {
      return { available: false, error: String(error) };
    }
  }

  private static probeUmu(): Record<string, unknown> {
    const binaryPath = app.isPackaged
      ? path.join(process.resourcesPath, "umu-run")
      : path.join(__dirname, "..", "..", "binaries", "umu", "umu-run");

    let exists = false;
    let sizeBytes: number | null = null;
    try {
      const stats = fs.statSync(binaryPath);
      exists = stats.isFile();
      sizeBytes = stats.size;
    } catch {
      exists = false;
    }

    return { binaryPath, exists, sizeBytes };
  }

  private static async probeSteam(): Promise<Record<string, unknown>> {
    const homePath = app.getPath("home");
    const steamRoots = [
      path.join(homePath, ".steam", "steam"),
      path.join(homePath, ".local", "share", "Steam"),
      path.join(
        homePath,
        ".var",
        "app",
        "com.valvesoftware.Steam",
        ".local",
        "share",
        "Steam"
      ),
    ];

    const roots = steamRoots.map((root) => ({
      path: root,
      exists: fs.existsSync(root),
    }));

    let libraries: string[] = [];
    try {
      libraries = await getSteamLibraryFolders();
    } catch (error) {
      libraries = [`[failed to parse libraryfolders.vdf: ${String(error)}]`];
    }

    const protonVersions = await Umu.getInstalledProtonVersions().catch(
      () => []
    );

    return {
      roots,
      libraries,
      protonVersions: protonVersions.slice(0, 20).map((version) => ({
        name: version.name,
        path: version.path,
        source: version.source,
      })),
    };
  }
}
