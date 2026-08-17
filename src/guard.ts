import { basename, isAbsolute, resolve } from "node:path";
import { globalContextFile, type Config } from "./config.ts";

const CONTEXT_FILENAMES = new Set(["CLAUDE.md", "CLAUDE.MD", "CLAUDE.local.md"]);

export interface GuardDecision {
  blocked: boolean;
  reason?: string;
}

const ALLOWED = { blocked: false } as const;

function isContextFile(path: string): boolean {
  return CONTEXT_FILENAMES.has(basename(path));
}

function targetsGlobal(config: Config, path: string): boolean {
  return resolve(path) === resolve(globalContextFile(config));
}

export function evaluateWrite(config: Config, cwd: string, rawPath: string): GuardDecision {
  const scope = config.guard.blockClaudeMdWrites;
  if (scope === "none" || !rawPath) {
    return ALLOWED;
  }

  const path = isAbsolute(rawPath) ? rawPath : resolve(cwd, rawPath);
  if (!isContextFile(path)) {
    return ALLOWED;
  }

  const global = targetsGlobal(config, path);
  if (global && (scope === "all" || scope === "global")) {
    return {
      blocked: true,
      reason: "Writing to the global CLAUDE.md is disabled by pi-claude-memory. Use /remember-globally instead.",
    };
  }

  if (!global && (scope === "all" || scope === "project")) {
    return {
      blocked: true,
      reason: "Writing to a project CLAUDE.md is disabled by pi-claude-memory. Use /remember to store project memory instead.",
    };
  }

  return ALLOWED;
}

const REDIRECT_PATTERN = /(?:>>?|\btee\b(?:\s+-a)?)\s*("[^"]+"|'[^']+'|\S+)/g;

export function evaluateBash(config: Config, cwd: string, command: string): GuardDecision {
  if (config.guard.blockClaudeMdWrites === "none" || !command) {
    return ALLOWED;
  }

  for (const match of command.matchAll(REDIRECT_PATTERN)) {
    const target = match[1]!.replace(/^["']|["']$/g, "");
    const decision = evaluateWrite(config, cwd, target);
    if (decision.blocked) {
      return decision;
    }
  }

  return ALLOWED;
}
