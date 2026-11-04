// Daily improvement agent — the brain behind .github/workflows/improvement.yml.
//
// Runs every day on a schedule and publishes a PT-BR report to the
// dedicated `reports` branch of this repository:
//
//   reports/reports/YYYY-MM-DD.md  — one file per day, newest wins
//   reports/state.json             — the agent's memory (upstream baseline,
//                                    previous counters)
//
// (A true GitHub fork has no Issues of its own — the REST issues API answers
// 410 — which is why the diary lives on a branch instead of a tracking
// issue. The branch keeps `main` free of bot commits.)
//
// Each report carries:
//
// - the quality-gate results of the workflow's own quality job (typecheck,
//   tests, lint), so the report is always a fresh measurement and not a
//   copy of the push CI
// - what happened in hydralauncher/hydra since the last report, each commit
//   classified by a heuristic (already ported / worth porting / evaluate /
//   not a priority) — the fork diverges on purpose (Google Drive cloud
//   saves, CachyOS as the default runtime), so these are suggestions,
//   never automatic action
// - repository pulse (latest release, open issue/PR counts from upstream's
//   tracker, TODO/FIXME/HACK and `any` counters with day-over-day deltas,
//   one rotating code hotspot)
// - the countdown to the monthly build (see monthly-build.yml, gated on the
//   newest hydra-plus-nightly-* artifact age)
//
// Everything is deterministic on purpose: no LLM, no external service, only
// git, the GitHub REST API and the token the workflow already has.
//
// Usage (all inputs arrive as environment variables from the workflow):
//   node scripts/improvement-agent.mjs

import { execSync } from "node:child_process";
import fs from "node:fs";

const UPSTREAM_OWNER_REPO = "hydralauncher/hydra";
const USER_TIME_ZONE = "America/Sao_Paulo";
const REPORTS_BRANCH = "reports";
const FOCUS_AREAS = [
  "src/main/services",
  "src/main/helpers",
  "src/renderer/src/pages",
  "src/renderer/src/components",
  "src/shared",
];
const MAX_TABLE_ROWS = 20;

const REPO = process.env.REPO;
const TOKEN = process.env.GITHUB_TOKEN;

const env = {
  headSha: process.env.HEAD_SHA || "",
  qualityResult: process.env.QUALITY_RESULT || "skipped",
  typecheck: process.env.QUALITY_TYPECHECK || "",
  tests: process.env.QUALITY_TESTS || "",
  testsSummary: process.env.QUALITY_TESTS_SUMMARY || "",
  lint: process.env.QUALITY_LINT || "",
  lintSummary: process.env.QUALITY_LINT_SUMMARY || "",
};

function requireEnv() {
  if (!REPO || !TOKEN) {
    console.error(
      "REPO and GITHUB_TOKEN must be set (provided by the workflow)."
    );
    process.exit(1);
  }
}

function git(args) {
  return execSync(`git ${args}`, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  }).trim();
}

async function api(path, options = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub API ${response.status} on ${path}`);
  }
  return response.json();
}

function shortSha(sha) {
  return (sha || "").slice(0, 7);
}

const fullDate = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "full",
  timeZone: USER_TIME_ZONE,
});
const shortDate = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeZone: USER_TIME_ZONE,
});

function saoPauloDateParts(date) {
  // yyyy-mm-dd in the audience time zone — the report file name.
  const parts = new Intl.DateTimeFormat("en-CA", {
    dateStyle: "short",
    timeZone: USER_TIME_ZONE,
  }).format(date);
  return parts;
}

function formatFullDate(value) {
  return fullDate.format(value);
}

function formatShortDate(value) {
  return shortDate.format(value);
}

// Everything that must be measured on `main`'s worktree (git grep and
// git ls-files walk the checked-out files) happens before the agent hops
// to the reports branch.
function measureMainWorktree() {
  // Cherry-picked syncs keep the original subject, so an exact subject
  // match against the fork history is a good-enough "already ported"
  // detector for upstream commits.
  const forkSubjects = new Set(
    git("log --format=%s HEAD")
      .split("\n")
      .map((subject) => subject.trim())
  );

  const countMatches = (pattern) => {
    try {
      return parseInt(git(`grep -EI "${pattern}" -- src | wc -l`), 10) || 0;
    } catch {
      return 0;
    }
  };

  return {
    forkSubjects,
    todoCount: countMatches("TODO|FIXME|HACK"),
    // POSIX-safe word boundary so `: anything` doesn't count as `: any`.
    anyCount: countMatches(": any([^[:alnum:]_]|$)"),
  };
}

// Heuristic port suggestion based on the conventional-commit prefix.
function classifySubject(subject) {
  const lowered = subject.toLowerCase();
  if (lowered.includes("security") || lowered.includes("cve")) {
    return "security";
  }
  const match = subject.match(/^(\w+)(\([^)]*\))?!?:/);
  const type = match ? match[1].toLowerCase() : "other";
  if (type === "fix") {
    return "port";
  }
  if (type === "feat" || type === "perf" || type === "refactor") {
    return "evaluate";
  }
  return "low";
}

const CLASSIFICATION_LABELS = {
  security: "⚠️ segurança — avaliar já",
  port: "📥 portar",
  evaluate: "🤔 avaliar",
  low: "📚 não prioritário",
};

function upstreamSection(state, forkSubjects) {
  const upstreamHead = git("rev-parse refs/remotes/upstream/main");
  const baseline = state.upstream_baseline || "";

  if (!baseline) {
    return {
      section: [
        `### 👁 Upstream — ${UPSTREAM_OWNER_REPO}`,
        "",
        `- baseline inicializado em \`${shortSha(upstreamHead)}\`. A partir do próximo relatório, os commits novos aparecem aqui com sugestão de port.`,
      ].join("\n"),
      newBaseline: upstreamHead,
    };
  }

  let commits;
  try {
    const raw = git(
      `log --format=%H%x1f%s%x1f%aI ${baseline}..refs/remotes/upstream/main`
    );
    commits = raw
      ? raw.split("\n").map((line) => {
          const [sha, subject, date] = line.split("\x1f");
          return { sha, subject, date };
        })
      : [];
  } catch (error) {
    console.warn(`Could not list upstream commits: ${error.message}`);
    return {
      section: [
        `### 👁 Upstream — ${UPSTREAM_OWNER_REPO}`,
        "",
        `- ⚠️ baseline \`${shortSha(baseline)}\` não foi encontrado no histórico raso do upstream; baseline reinicializado em \`${shortSha(upstreamHead)}\`. Commits no intervalo ficaram sem relatório nesta passada.`,
      ].join("\n"),
      newBaseline: upstreamHead,
    };
  }

  if (commits.length === 0) {
    return {
      section: [
        `### 👁 Upstream — ${UPSTREAM_OWNER_REPO}`,
        "",
        `Nenhum commit novo no upstream desde o último relatório (\`${shortSha(baseline)}\`). 🎉`,
      ].join("\n"),
      newBaseline: baseline,
    };
  }

  const ported = [];
  const fresh = [];
  for (const commit of commits) {
    if (forkSubjects.has(commit.subject)) {
      ported.push(commit);
    } else {
      fresh.push(commit);
    }
  }

  const tallies = { security: 0, port: 0, evaluate: 0, low: 0 };
  const rows = [];
  for (const commit of fresh) {
    const classification = classifySubject(commit.subject);
    tallies[classification] += 1;
    if (rows.length < MAX_TABLE_ROWS) {
      const subject = commit.subject.slice(0, 90);
      rows.push(
        `| \`${shortSha(commit.sha)}\` | ${subject} | ${CLASSIFICATION_LABELS[classification]} |`
      );
    }
  }
  if (fresh.length > MAX_TABLE_ROWS) {
    rows.push(
      `| … | mais ${fresh.length - MAX_TABLE_ROWS} commits na página do upstream | |`
    );
  }

  const lines = [
    `### 👁 Upstream — ${UPSTREAM_OWNER_REPO}`,
    "",
    `**${commits.length} commit(s) novo(s)** desde \`${shortSha(baseline)}\`:`,
    "",
    "| commit | título | avaliação |",
    "| --- | --- | --- |",
    ...rows,
  ];

  if (ported.length > 0) {
    lines.push(
      "",
      `✅ já presentes no fork (mesmo assunto): ${ported.length}.`
    );
  }
  lines.push(
    "",
    `Resumo: 📥 portar ${tallies.port} · 🤔 avaliar ${tallies.evaluate} · 📚 não prioritário ${tallies.low}${
      tallies.security > 0
        ? ` · ⚠️ **${tallies.security} com cara de segurança**`
        : ""
    }`,
    `- baseline avançou para \`${shortSha(upstreamHead)}\`.`
  );

  return { section: lines.join("\n"), newBaseline: upstreamHead };
}

function qualitySection() {
  const mark = (value) => {
    if (value === "pass") return "✅";
    if (value === "fail") return "❌";
    return "➖";
  };

  const jobMark =
    env.qualityResult === "success"
      ? "✅"
      : env.qualityResult === "failure"
        ? "❌"
        : "➖";

  const lines = [
    "### ✅ Gates de qualidade — `main` " +
      (env.headSha ? `@ \`${shortSha(env.headSha)}\`` : ""),
    "",
    `Resultado geral do job: ${jobMark}`,
    "",
    "| gate | resultado |",
    "| --- | --- |",
    `| typecheck | ${mark(env.typecheck)} |`,
    `| testes | ${mark(env.tests)}${env.testsSummary ? ` — ${env.testsSummary}` : ""} |`,
    `| lint | ${mark(env.lint)}${env.lintSummary ? ` — ${env.lintSummary}` : ""} |`,
  ];

  if (env.qualityResult === "failure") {
    lines.push(
      "",
      "🔴 **Um gate falhou** — o log completo está na execução do workflow *Improvement Agent*."
    );
  }

  return lines.join("\n");
}

function deltaText(current, previous) {
  if (previous === undefined || previous === null || previous === "") {
    return "(primeira medição)";
  }
  const delta = current - Number(previous);
  if (Number.isNaN(delta)) {
    return "(primeira medição)";
  }
  return `(Δ ${delta >= 0 ? "+" : ""}${delta})`;
}

function hotspotSection() {
  const now = new Date();
  const startOfYear = Date.UTC(now.getUTCFullYear(), 0, 0);
  const dayOfYear = Math.floor((now.getTime() - startOfYear) / 86400000);
  const area = FOCUS_AREAS[dayOfYear % FOCUS_AREAS.length];

  let top;
  try {
    top = git(`ls-files "${area}" | xargs wc -l | sort -rn | head -6`);
  } catch {
    return "";
  }

  const entries = top
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("total"))
    .map((line) => {
      const match = line.match(/^(\d+)\s+(.*)$/);
      return match ? { lines: parseInt(match[1], 10), file: match[2] } : null;
    })
    .filter((entry) => entry)
    .slice(0, 5);

  if (entries.length === 0) {
    return "";
  }

  const listed = entries
    .map((entry) => `\`${entry.file}\` (${entry.lines} linhas)`)
    .join(", ");

  return [
    `### 🔍 Hotspot do dia — \`${area}\``,
    "",
    `Maiores arquivos (candidatos a divisão/refatoração quando mexar de novo): ${listed}.`,
  ].join("\n");
}

async function safeApi(path, fallback) {
  try {
    return await api(path);
  } catch (error) {
    console.warn(`API call failed (${path}): ${error.message}`);
    return fallback;
  }
}

async function pulseSection(state, measurements) {
  const release = await safeApi(`/repos/${REPO}/releases/latest`, null);
  // This repo is a fork: it has no issue tracker of its own, so the pulse
  // reads upstream's tracker for a sense of community activity.
  const upstreamIssues = await safeApi(
    `/repos/${UPSTREAM_OWNER_REPO}/issues?state=open&per_page=1`,
    null
  );

  const lines = ["### 📊 Pulso do repositório", ""];
  if (release) {
    lines.push(
      `- Release atual: **${release.tag_name}** — publicada em ${formatShortDate(
        new Date(release.published_at)
      )} · ${release.assets.length} assets`
    );
  }
  if (upstreamIssues) {
    lines.push(
      `- Tracker do upstream (${UPSTREAM_OWNER_REPO}): ${upstreamIssues.length ? "100+" : "<100"} issues/PRs abertos`
    );
  }
  lines.push(
    `- Code smells em \`src/\`: ${measurements.todoCount} TODO/FIXME/HACK ${deltaText(
      measurements.todoCount,
      state.prev_todo
    )} · ${measurements.anyCount} \`any\` ${deltaText(measurements.anyCount, state.prev_any)}`
  );

  return lines.join("\n");
}

async function monthlyBuildSection() {
  const artifacts = await safeApi(
    `/repos/${REPO}/actions/artifacts?per_page=100`,
    null
  );
  if (!artifacts) {
    return "### 🔨 Build mensal\n\n- indisponível (API de artifacts falhou)";
  }

  const nightlyDates = artifacts.artifacts
    .filter((artifact) => artifact.name.startsWith("hydra-plus-nightly-"))
    .map((artifact) => artifact.created_at)
    .sort();

  if (nightlyDates.length === 0) {
    return [
      "### 🔨 Build mensal",
      "",
      "- nenhuma build nightly ainda — a próxima janela do `monthly-build.yml` constrói a primeira e ancora o ciclo de 30 dias.",
    ].join("\n");
  }

  const last = new Date(nightlyDates[nightlyDates.length - 1]);
  const next = new Date(last.getTime() + 30 * 24 * 60 * 60 * 1000);
  const daysLeft = Math.ceil(
    (next.getTime() - Date.now()) / (24 * 60 * 60 * 1000)
  );

  return [
    "### 🔨 Build mensal",
    "",
    `- Última build nightly: ${formatShortDate(last)} → próxima prevista: **${formatShortDate(
      next
    )}** (faltam ~${daysLeft} dias)`,
  ].join("\n");
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync("state.json", "utf8"));
  } catch {
    return {};
  }
}

function switchToReportsBranch() {
  let branchExists = false;
  try {
    git("fetch origin refs/heads/reports:refs/remotes/origin/reports");
    branchExists = true;
  } catch {
    console.log("No existing reports branch — creating an orphan one.");
  }

  if (branchExists) {
    git("checkout -B reports refs/remotes/origin/reports");
  } else {
    git("checkout --orphan reports");
    git("rm -rf --quiet .");
  }

  git('config user.name "github-actions[bot]"');
  git(
    'config user.email "41898282+github-actions[bot]@users.noreply.github.com"'
  );
}

function writeReportsBranchReadmeOnce() {
  if (fs.existsSync("README.md")) {
    return;
  }
  fs.writeFileSync(
    "README.md",
    [
      "# Relatórios do agente de melhoria contínua",
      "",
      `Este branch é o diário de bordo automatizado do hydra-plus. O agente roda todos os dias (workflow *Improvement Agent*) e escreve um arquivo por dia em \`reports/\`.`,
      "",
      "- ✅ gates de qualidade do `main` medidos na hora (typecheck, testes, lint)",
      `- 👁 o que o Hydra original (${UPSTREAM_OWNER_REPO}) fez de novo e se vale a pena portar`,
      "- 📊 pulso do repositório (release, code smells, hotspot do dia)",
      "- 🔨 contagem regressiva para a build mensal (a cada 30 dias, workflow *Monthly Build*)",
      "",
      "> ⚠️ Relatórios gerados por automação determinística (sem LLM). Sugestões de port são heurísticas baseadas no prefixo do commit; a decisão final é sempre manual — o fork diverge do upstream de propósito (cloud saves no Google Drive, CachyOS como runtime padrão).",
      "",
      "O estado do agente (baseline do upstream, contadores anteriores) fica em `state.json`.",
      "",
    ].join("\n")
  );
}

async function main() {
  requireEnv();

  const measurements = measureMainWorktree();

  switchToReportsBranch();
  const state = loadState();

  const upstream = upstreamSection(state, measurements.forkSubjects);

  const comment = [
    `## 🤖 Relatório diário — ${formatFullDate(new Date())}`,
    "",
    qualitySection(),
    "",
    upstream.section,
    "",
    await pulseSection(state, measurements),
    "",
    hotspotSection(),
    "",
    await monthlyBuildSection(),
    "",
    "---",
    "",
    "*Relatório automático — sugestões de port são heurísticas; a decisão é sempre manual.*",
  ].join("\n");

  const today = saoPauloDateParts(new Date());
  fs.mkdirSync("reports", { recursive: true });
  fs.writeFileSync(`reports/${today}.md`, `${comment}\n`);

  const nextState = {
    upstream_baseline: upstream.newBaseline,
    prev_todo: measurements.todoCount,
    prev_any: measurements.anyCount,
    last_report: today,
  };
  fs.writeFileSync("state.json", `${JSON.stringify(nextState, null, 2)}\n`);

  writeReportsBranchReadmeOnce();

  git("add README.md state.json reports");
  git(`commit -m "chore(agent): daily report ${today}"`);
  git(`push origin ${REPORTS_BRANCH}`);

  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${comment}\n`);
  }

  console.log(
    `Daily report published: https://github.com/${REPO}/blob/reports/reports/${today}.md`
  );
}

main().catch((error) => {
  console.error(`Improvement agent failed: ${error.message}`);
  process.exit(1);
});
