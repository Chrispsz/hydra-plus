/**
 * Launch flags catalog — per-game boolean launch switches stored as stable
 * kebab-case ids on the Game record (`Game.launchFlags`).
 *
 * Values are extracted from ProtonPlus
 * (`src/widgets/games/launch-options-editor/launch-options-option-catalog.vala`
 * and `docs/launch-options.md`) — only the command semantics were ported,
 * not the editor. Every flag is a clean boolean: either a wrapper command
 * or a fixed `NAME=value` environment assignment.
 *
 * This module is intentionally free of i18n and of Electron/main-process
 * imports: the renderer derives labels via `t("launch_flags.${id}")` and
 * the main-process services feed the resolution into
 * `resolveLaunchCommand` / the launch environment.
 */

export type LaunchFlagKind = "env" | "wrapper";

/** Host tool a wrapper flag needs on PATH before it can be applied. */
export type LaunchFlagAvailability = "mangohud" | "gamemode" | "gamescope";

/** Probed host availability, keyed by tool (services probe before resolving). */
export type LaunchFlagAvailabilityProbe = Record<
  LaunchFlagAvailability,
  boolean
>;

export interface LaunchFlagDefinition {
  /** Stable kebab-case id persisted on the game record. */
  id: string;
  kind: LaunchFlagKind;
  /**
   * Exact command semantics from ProtonPlus: for `env` the fixed
   * `NAME=value` assignment, for `wrapper` the wrapper executable.
   */
  value: string;
  /** Only wrapper flags require a host tool; env flags are inert without
   *  their consumer and always pass through. */
  availability?: LaunchFlagAvailability;
  notes?: string;
}

/**
 * LEAN subset of the ProtonPlus catalog. Wrapper entries are listed in
 * emission/nesting order (ProtonPlus wrapper registry order: mangohud 10 →
 * gamemode 20 → gamescope 30), so `mangohud gamemoderun gamescope <cmd>`
 * is the canonical composition — identical to ProtonPlus's managed line.
 */
export const LAUNCH_FLAG_CATALOG: readonly LaunchFlagDefinition[] = [
  {
    id: "mangohud",
    kind: "wrapper",
    value: "mangohud",
    availability: "mangohud",
    notes:
      "OpenGL-capable wrapper; MANGOHUD=1 (Vulkan env mode) is a separate advanced ProtonPlus option.",
  },
  {
    id: "gamemode",
    kind: "wrapper",
    value: "gamemoderun",
    availability: "gamemode",
    notes: "Same wrapper the legacy autoRunGamemode toggle produces.",
  },
  {
    id: "gamescope",
    kind: "wrapper",
    value: "gamescope",
    availability: "gamescope",
    notes:
      "ProtonPlus emits `gamescope -- <cmd>`; a bare wrapper works because the first non-option token starts the command. Resolution options (-W/-H/-f/…) need a wrapper-args mechanism — follow-up.",
  },
  {
    id: "dxvk-async",
    kind: "env",
    value: "DXVK_ASYNC=1",
    notes:
      "Experimental; requires a patched DXVK build (dxvk-async / glypine patches).",
  },
  {
    id: "dxvk-hdr",
    kind: "env",
    value: "DXVK_HDR=1",
    notes:
      "ProtonPlus current explicit DXVK HDR switch (NOT DXVK_ENABLE_HDR). Requires an HDR-capable compositor/display, Vulkan 1.3 and a recent driver.",
  },
  {
    id: "nvidia-nvapi",
    kind: "env",
    value: "PROTON_ENABLE_NVAPI=1",
    notes: "NVIDIA NVAPI exposure (DLSS etc.).",
  },
  {
    id: "proton-hdr",
    kind: "env",
    value: "PROTON_ENABLE_HDR=1",
    notes:
      "Legacy path: only custom Proton builds that still advertise PROTON_ENABLE_HDR.",
  },
  {
    id: "proton-log",
    kind: "env",
    value: "PROTON_LOG=1",
    notes:
      "Proton writes steam-<appid>.log to $HOME unless PROTON_LOG_DIR is set.",
  },
  {
    id: "vkd3d-shader-cache",
    kind: "env",
    value: "VKD3D_SHADER_CACHE=1",
    notes: "VKD3D-Proton internal shader cache.",
  },
  {
    id: "amd-fsr4",
    kind: "env",
    value: "PROTON_FSR4_UPGRADE=1",
    notes:
      "Selects the installed custom Proton build's default FSR 4 release; requires a build that advertises PROTON_FSR4_UPGRADE plus supported AMD hardware/drivers.",
  },
];

const LAUNCH_FLAG_BY_ID = new Map<string, LaunchFlagDefinition>(
  LAUNCH_FLAG_CATALOG.map((definition) => [definition.id, definition])
);

/** Wrapper commands in canonical nesting order (outermost first). */
const LAUNCH_WRAPPER_COMMAND_ORDER: readonly string[] =
  LAUNCH_FLAG_CATALOG.filter((definition) => definition.kind === "wrapper").map(
    (definition) => definition.value
  );

const envVariableNameRegex = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface LaunchFlagResolution {
  /** Environment assignments from `env` flags, ready to spread into the
   *  launch environment BELOW the user's free-text launchOptions env (the
   *  user's explicit assignments win). */
  env: Record<string, string>;
  /** Wrapper commands in canonical nesting order (first = outermost),
   *  ready for `resolveLaunchCommand`'s `wrapperCommands`. */
  wrapperCommands: string[];
  /** Ids not present in the catalog — ignored (callers log them). */
  unknownFlagIds: string[];
  /** Wrapper flag ids dropped because their host tool is unavailable. */
  unavailableFlagIds: string[];
}

const parseEnvAssignment = (assignment: string) => {
  const separatorIndex = assignment.indexOf("=");

  if (separatorIndex <= 0) return null;

  const name = assignment.slice(0, separatorIndex);

  if (!envVariableNameRegex.test(name)) return null;

  return { name, value: assignment.slice(separatorIndex + 1) };
};

const wrapperCommandRank = (command: string): number => {
  const index = LAUNCH_WRAPPER_COMMAND_ORDER.indexOf(command);
  return index === -1 ? LAUNCH_WRAPPER_COMMAND_ORDER.length : index;
};

/** Deduplicates and re-establishes the canonical nesting order. */
const normalizeWrapperCommands = (commands: readonly string[]): string[] =>
  Array.from(new Set(commands)).sort(
    (a, b) => wrapperCommandRank(a) - wrapperCommandRank(b)
  );

export const getLaunchFlagDefinition = (
  id: string
): LaunchFlagDefinition | undefined => LAUNCH_FLAG_BY_ID.get(id);

/**
 * Resolves catalog launch flag ids into environment assignments and
 * wrapper commands. Unknown ids are ignored (and reported) so a stale
 * record from an older catalog can never break a launch.
 *
 * Availability: when the probe map is provided, a wrapper flag is only
 * applied when its tool is explicitly available — a missing wrapper on
 * PATH would otherwise make the spawned command fail. When the map is
 * omitted, ALL wrapper flags are dropped (conservative: never spawn an
 * unprobed wrapper); env flags always pass through.
 */
export const resolveLaunchFlags = (
  flagIds: readonly string[] | null | undefined,
  availability?: LaunchFlagAvailabilityProbe
): LaunchFlagResolution => {
  const env: Record<string, string> = {};
  const wrapperCommands: string[] = [];
  const unknownFlagIds: string[] = [];
  const unavailableFlagIds: string[] = [];
  const seenIds = new Set<string>();

  for (const id of flagIds ?? []) {
    if (typeof id !== "string" || id.length === 0 || seenIds.has(id)) {
      continue;
    }

    seenIds.add(id);

    const definition = LAUNCH_FLAG_BY_ID.get(id);

    if (!definition) {
      unknownFlagIds.push(id);
      continue;
    }

    if (definition.kind === "env") {
      const assignment = parseEnvAssignment(definition.value);

      if (assignment) {
        env[assignment.name] = assignment.value;
      }

      continue;
    }

    if (
      !availability ||
      !definition.availability ||
      availability[definition.availability] !== true
    ) {
      if (definition.availability) {
        unavailableFlagIds.push(id);
      }

      continue;
    }

    wrapperCommands.push(definition.value);
  }

  return {
    env,
    wrapperCommands: normalizeWrapperCommands(wrapperCommands),
    unknownFlagIds,
    unavailableFlagIds,
  };
};

export interface LegacyLaunchToggles {
  /** Legacy `autoRunMangohud` (game record / user preferences), gated upstream. */
  useMangohud?: boolean;
  /** Legacy `autoRunGamemode` (game record / user preferences), gated upstream. */
  useGamemode?: boolean;
}

/**
 * Combines resolved launch flags with the legacy `autoRun*` toggles
 * WITHOUT changing the legacy behavior:
 *
 * - `useMangohud` still contributes the `MANGOHUD=1` env assignment (the
 *   umu/proton paths enable the Vulkan overlay through env, not wrapper);
 * - `useGamemode` still contributes the `gamemoderun` wrapper — a `gamemode`
 *   flag plus the toggle collapse into a single `gamemoderun` (no
 *   duplication), keeping the flag's catalog nesting position.
 */
export const mergeLegacyLaunchToggles = (
  resolution: LaunchFlagResolution,
  toggles: LegacyLaunchToggles = {}
): LaunchFlagResolution => {
  const wrapperCommands = normalizeWrapperCommands([
    ...resolution.wrapperCommands,
    ...(toggles.useGamemode ? ["gamemoderun"] : []),
  ]);

  return {
    env: {
      ...resolution.env,
      ...(toggles.useMangohud ? { MANGOHUD: "1" } : {}),
    },
    wrapperCommands,
    unknownFlagIds: resolution.unknownFlagIds,
    unavailableFlagIds: resolution.unavailableFlagIds,
  };
};
