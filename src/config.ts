import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

export type MemoryType = "user" | "feedback" | "project" | "reference";
export type GuardScope = "all" | "project" | "global" | "none";

export interface Config {
  claudeDir: string;
  scope: "gitRoot" | "cwd";
  inject: {
    full: MemoryType[];
    indexOnly: MemoryType[];
    projectContextFile: boolean;
    globalContextFile: boolean;
  };
  budget: {
    maxBytes: number;
    warnOnExceed: boolean;
  };
  guard: {
    blockClaudeMdWrites: GuardScope;
  };
}

export const MEMORY_TYPES: MemoryType[] = ["user", "feedback", "project", "reference"];

const DEFAULTS: Config = {
  claudeDir: join(homedir(), ".claude"),
  scope: "gitRoot",
  inject: {
    full: ["feedback", "user"],
    indexOnly: ["project", "reference"],
    projectContextFile: true,
    globalContextFile: true,
  },
  budget: {
    maxBytes: 65536,
    warnOnExceed: true,
  },
  guard: {
    blockClaudeMdWrites: "project",
  },
};

export const CONFIG_FILENAME = "claude-memory.json";

function expandHome(value: string): string {
  if (value === "~") {
    return homedir();
  }
  if (value.startsWith("~/")) {
    return join(homedir(), value.slice(2));
  }
  return value;
}

function readJson(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function pickTypes(value: unknown, fallback: MemoryType[]): MemoryType[] {
  if (!Array.isArray(value)) {
    return fallback;
  }
  const picked = value.filter((entry): entry is MemoryType =>
    MEMORY_TYPES.includes(entry as MemoryType),
  );
  return picked.length === value.length ? picked : fallback;
}

function pickBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function pickPositiveInt(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function mergeConfig(base: Config, raw: Record<string, unknown> | null, configPath: string): Config {
  if (!raw) {
    return base;
  }

  const inject = (raw.inject ?? {}) as Record<string, unknown>;
  const budget = (raw.budget ?? {}) as Record<string, unknown>;
  const guard = (raw.guard ?? {}) as Record<string, unknown>;
  const guardScope = guard.blockClaudeMdWrites;

  const claudeDir =
    typeof raw.claudeDir === "string" && raw.claudeDir.length > 0
      ? expandHome(raw.claudeDir)
      : base.claudeDir;

  return {
    claudeDir: isAbsolute(claudeDir) ? claudeDir : resolve(configPath, "..", claudeDir),
    scope: raw.scope === "cwd" || raw.scope === "gitRoot" ? raw.scope : base.scope,
    inject: {
      full: pickTypes(inject.full, base.inject.full),
      indexOnly: pickTypes(inject.indexOnly, base.inject.indexOnly),
      projectContextFile: pickBoolean(inject.projectContextFile, base.inject.projectContextFile),
      globalContextFile: pickBoolean(inject.globalContextFile, base.inject.globalContextFile),
    },
    budget: {
      maxBytes: pickPositiveInt(budget.maxBytes, base.budget.maxBytes),
      warnOnExceed: pickBoolean(budget.warnOnExceed, base.budget.warnOnExceed),
    },
    guard: {
      blockClaudeMdWrites:
        guardScope === "all" || guardScope === "project" || guardScope === "global" || guardScope === "none"
          ? guardScope
          : base.guard.blockClaudeMdWrites,
    },
  };
}

export interface LoadConfigOptions {
  globalConfigPath: string;
  projectConfigPath?: string | null;
  env?: NodeJS.ProcessEnv;
}

export function loadConfig(options: LoadConfigOptions): Config {
  const env = options.env ?? process.env;
  let config = DEFAULTS;

  const envClaudeDir = env.CLAUDE_CONFIG_DIR;
  if (envClaudeDir && envClaudeDir.length > 0) {
    config = { ...config, claudeDir: expandHome(envClaudeDir) };
  }

  config = mergeConfig(config, readJson(options.globalConfigPath), options.globalConfigPath);

  if (options.projectConfigPath) {
    config = mergeConfig(config, readJson(options.projectConfigPath), options.projectConfigPath);
  }

  return config;
}

export function globalContextFile(config: Config): string {
  return join(config.claudeDir, "CLAUDE.md");
}
