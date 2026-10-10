import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { DebugLogEntry, DebugExportResult } from "./global.d";

const LEVEL_COLORS: Record<DebugLogEntry["level"], string> = {
  debug: "#6b7280",
  info: "#c9d1d9",
  warn: "#f0b429",
  error: "#f85149",
};

const LEVEL_BG: Record<DebugLogEntry["level"], string> = {
  debug: "transparent",
  info: "transparent",
  warn: "rgba(240, 180, 41, 0.08)",
  error: "rgba(248, 81, 73, 0.10)",
};

const MAX_RENDERED = 4000;

const levelChipStyle = (active: boolean): React.CSSProperties => ({
  backgroundColor: active ? "#2f4a6b" : "#1d2129",
  color: active ? "#9ecbff" : "#5a6472",
  border: "1px solid",
  borderColor: active ? "#3d5a80" : "#2a2e37",
  borderRadius: 999,
  padding: "3px 10px",
  fontSize: 11,
  cursor: "pointer",
  userSelect: "none",
  textTransform: "uppercase",
  letterSpacing: 0.5,
  font: "inherit",
  fontFamily: "inherit",
});

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: "flex",
    flexDirection: "column",
    height: "100vh",
    backgroundColor: "#111318",
    color: "#c9d1d9",
    fontFamily:
      "'JetBrains Mono', 'Fira Code', ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 12,
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
    padding: "8px 12px",
    backgroundColor: "#1a1d24",
    borderBottom: "1px solid #2a2e37",
    flexShrink: 0,
  },
  title: {
    fontWeight: 700,
    fontSize: 12,
    letterSpacing: 0.4,
    color: "#e6edf3",
    marginRight: 6,
    whiteSpace: "nowrap",
  },
  button: {
    backgroundColor: "#232830",
    color: "#c9d1d9",
    border: "1px solid #2f353f",
    borderRadius: 6,
    padding: "4px 10px",
    fontSize: 11,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  search: {
    flex: 1,
    minWidth: 140,
    backgroundColor: "#111318",
    border: "1px solid #2f353f",
    borderRadius: 6,
    color: "#c9d1d9",
    padding: "4px 10px",
    fontSize: 12,
    outline: "none",
  },
  counter: { color: "#5a6472", fontSize: 11, whiteSpace: "nowrap" },
  list: { flex: 1, overflowY: "auto", padding: "6px 0" },
  footer: {
    padding: "4px 12px 6px",
    backgroundColor: "#1a1d24",
    borderTop: "1px solid #2a2e37",
    color: "#5a6472",
    fontSize: 11,
    flexShrink: 0,
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
  },
  entry: { padding: "2px 12px", lineHeight: 1.45 },
  entryHeader: { display: "flex", gap: 8, alignItems: "baseline" },
  ts: { color: "#5a6472", flexShrink: 0 },
  scope: {
    color: "#7ee787",
    opacity: 0.85,
    flexShrink: 0,
    maxWidth: 220,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  message: { whiteSpace: "pre-wrap", wordBreak: "break-word" },
  data: {
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    color: "#8b949e",
    margin: "2px 0 4px 0",
    paddingLeft: 8,
    borderLeft: "2px solid #2a2e37",
  },
  envPanel: {
    position: "absolute",
    top: 48,
    left: 12,
    right: 12,
    maxHeight: "70vh",
    overflowY: "auto",
    backgroundColor: "#161a20",
    border: "1px solid #2f353f",
    borderRadius: 8,
    padding: 14,
    zIndex: 10,
    boxShadow: "0 12px 32px rgba(0,0,0,0.5)",
  },
  envSection: { marginBottom: 12 },
  envTitle: {
    color: "#9ecbff",
    fontWeight: 700,
    marginBottom: 4,
    textTransform: "uppercase",
    fontSize: 11,
    letterSpacing: 0.6,
  },
  envLine: { color: "#c9d1d9", paddingLeft: 10, lineHeight: 1.6 },
  closeButton: {
    position: "absolute",
    top: 8,
    right: 12,
    zIndex: 11,
  },
};

const formatValue = (value: unknown, indent = 0): string => {
  if (value === null || value === undefined) return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return `\n${value
      .map(
        (item) => `${"  ".repeat(indent + 1)}• ${formatValue(item, indent + 2)}`
      )
      .join("")}`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return "{}";
    return `\n${entries
      .map(
        ([key, val]) =>
          `${"  ".repeat(indent + 1)}${key}: ${formatValue(val, indent + 2)}`
      )
      .join("")}`;
  }
  return String(value);
};

const EnvPanel: React.FC<{
  snapshot: Record<string, unknown>;
  onClose: () => void;
}> = ({ snapshot, onClose }) => (
  <div style={styles.envPanel}>
    <button
      style={{ ...styles.button, ...styles.closeButton }}
      onClick={onClose}
    >
      Fechar (Esc)
    </button>
    {Object.entries(snapshot).map(([section, value]) => (
      <div key={section} style={styles.envSection}>
        <div style={styles.envTitle}>{section}</div>
        <div style={styles.envLine}>{formatValue(value)}</div>
      </div>
    ))}
  </div>
);

export const DebugConsoleApp: React.FC = () => {
  const [entries, setEntries] = useState<DebugLogEntry[]>([]);
  const [levels, setLevels] = useState<Set<string>>(
    new Set(["debug", "info", "warn", "error"])
  );
  const [query, setQuery] = useState("");
  const [autoscroll, setAutoscroll] = useState(true);
  const [envSnapshot, setEnvSnapshot] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [status, setStatus] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const entriesMapRef = useRef<Map<number, DebugLogEntry>>(new Map());

  const rebuildEntries = useCallback(() => {
    const all = Array.from(entriesMapRef.current.values()).sort(
      (a, b) => a.seq - b.seq
    );
    const trimmed = all.slice(-MAX_RENDERED);
    setEntries(trimmed);
  }, []);

  useEffect(() => {
    let disposed = false;
    const applyEntry = (entry: DebugLogEntry) => {
      if (!entry || typeof entry.seq !== "number") return;
      entriesMapRef.current.set(entry.seq, entry);
    };

    const unsubscribe = window.debugConsole.onNewLog((entry) => {
      if (disposed) return;
      applyEntry(entry);
      rebuildEntries();
    });

    window.debugConsole
      .getBuffer()
      .then((buffer) => {
        if (disposed) return;
        buffer.forEach(applyEntry);
        rebuildEntries();
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [rebuildEntries]);

  useEffect(() => {
    if (!autoscroll || !listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [entries, autoscroll]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (envSnapshot) setEnvSnapshot(null);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [envSnapshot]);

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return entries.filter((entry) => {
      if (!levels.has(entry.level)) return false;
      if (!normalizedQuery) return true;
      return (
        entry.message.toLowerCase().includes(normalizedQuery) ||
        entry.scope.toLowerCase().includes(normalizedQuery) ||
        (entry.data ?? "").toLowerCase().includes(normalizedQuery)
      );
    });
  }, [entries, levels, query]);

  const levelCounts = useMemo(() => {
    const counts = { debug: 0, info: 0, warn: 0, error: 0 };
    for (const entry of entries) counts[entry.level] += 1;
    return counts;
  }, [entries]);

  const toggleLevel = (level: string) => {
    setLevels((current) => {
      const next = new Set(current);
      if (next.has(level)) {
        if (next.size > 1) next.delete(level);
      } else {
        next.add(level);
      }
      return next;
    });
  };

  const serializeVisible = () =>
    filtered
      .map((entry) => {
        const dataPart = entry.data ? `\n    ${entry.data}` : "";
        return `[${entry.ts}] [${entry.level.toUpperCase()}] [${entry.scope}] ${entry.message}${dataPart}`;
      })
      .join("\n");

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(serializeVisible());
      setStatus(
        `${filtered.length} linhas copiadas para a área de transferência`
      );
    } catch {
      setStatus("Falha ao copiar");
    }
  };

  const handleExport = async () => {
    try {
      const result: DebugExportResult = await window.debugConsole.exportLog();
      setStatus(`Log exportado: ${result.path} (${result.count} entradas)`);
    } catch (error) {
      setStatus(`Falha ao exportar: ${String(error)}`);
    }
  };

  const handleClear = async () => {
    entriesMapRef.current.clear();
    rebuildEntries();
    await window.debugConsole.clear().catch(() => undefined);
    setStatus("Console limpo (o buffer continua acumulando em tempo real)");
  };

  const handleEnv = async () => {
    setStatus("Coletando snapshot de ambiente…");
    try {
      const snapshot = await window.debugConsole.envDump();
      setEnvSnapshot(snapshot);
      setStatus("Snapshot de ambiente carregado");
    } catch (error) {
      setStatus(`Falha ao coletar ambiente: ${String(error)}`);
    }
  };

  const handleClose = () => {
    window.debugConsole.close().catch(() => undefined);
  };

  return (
    <div style={styles.root}>
      <div style={styles.header}>
        <span style={styles.title}>HYDRA PLUS · CONSOLE DE DEBUG</span>
        <button style={styles.button} onClick={handleEnv}>
          Ambiente
        </button>
        <button style={styles.button} onClick={handleCopy}>
          Copiar
        </button>
        <button style={styles.button} onClick={handleExport}>
          Exportar .log
        </button>
        <button style={styles.button} onClick={handleClear}>
          Limpar
        </button>
        <button style={styles.button} onClick={handleClose}>
          Fechar
        </button>
        <input
          style={styles.search}
          placeholder="Filtrar por texto (mensagem, escopo, dados)…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {(["debug", "info", "warn", "error"] as const).map((level) => (
          <button
            key={level}
            type="button"
            style={levelChipStyle(levels.has(level))}
            onClick={() => toggleLevel(level)}
          >
            {level} {levelCounts[level]}
          </button>
        ))}
        <button
          type="button"
          style={levelChipStyle(autoscroll)}
          onClick={() => setAutoscroll((value) => !value)}
        >
          auto-scroll
        </button>
      </div>

      <div style={styles.list} ref={listRef}>
        {filtered.map((entry) => (
          <div
            key={entry.seq}
            style={{
              ...styles.entry,
              backgroundColor: LEVEL_BG[entry.level],
            }}
          >
            <div style={styles.entryHeader}>
              <span style={styles.ts}>{entry.ts.slice(11, 23)}</span>
              <span
                style={{
                  ...styles.scope,
                  color:
                    entry.level === "error"
                      ? "#f85149"
                      : entry.level === "warn"
                        ? "#f0b429"
                        : "#7ee787",
                }}
              >
                [{entry.scope}]
              </span>
              <span
                style={{ ...styles.message, color: LEVEL_COLORS[entry.level] }}
              >
                {entry.message}
              </span>
            </div>
            {entry.data ? <div style={styles.data}>{entry.data}</div> : null}
          </div>
        ))}
        {filtered.length === 0 ? (
          <div style={{ ...styles.entry, color: "#5a6472" }}>
            {entries.length === 0
              ? "Aguardando eventos… interaja com o launcher (abrir jogo, cloud save, downloads) e os logs aparecerão aqui."
              : "Nenhuma linha corresponde aos filtros atuais."}
          </div>
        ) : null}
      </div>

      <div style={styles.footer}>
        <span>
          {filtered.length} de {entries.length} entradas em memória · sessão em{" "}
          debug-session.log
        </span>
        <span>{status}</span>
      </div>

      {envSnapshot ? (
        <EnvPanel snapshot={envSnapshot} onClose={() => setEnvSnapshot(null)} />
      ) : null}
    </div>
  );
};
