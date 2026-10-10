export interface DebugLogEntry {
  seq: number;
  ts: string;
  level: "debug" | "info" | "warn" | "error";
  scope: string;
  message: string;
  data?: string;
}

export interface DebugExportResult {
  path: string;
  count: number;
}

export interface DebugConsoleBridge {
  getBuffer(): Promise<DebugLogEntry[]>;
  clear(): Promise<boolean>;
  exportLog(): Promise<DebugExportResult>;
  envDump(): Promise<Record<string, unknown>>;
  close(): Promise<boolean>;
  open(): Promise<boolean>;
  onNewLog(callback: (entry: DebugLogEntry) => void): () => void;
}

declare global {
  interface Window {
    debugConsole: DebugConsoleBridge;
  }
}

export {};
