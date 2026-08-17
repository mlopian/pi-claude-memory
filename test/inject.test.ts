import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Config } from "../src/config.ts";
import { buildMemoryBlock, MemoryCache } from "../src/inject.ts";
import { writeMemory } from "../src/memory-store.ts";
import { memoryDir } from "../src/slug.ts";

let base: string;
let claudeDir: string;
let repo: string;

function config(overrides: Partial<Config> = {}): Config {
  return {
    claudeDir,
    scope: "gitRoot",
    inject: { full: ["feedback", "user"], indexOnly: ["project", "reference"], projectContextFile: true, globalContextFile: true },
    budget: { maxBytes: 65536, warnOnExceed: true },
    guard: { blockClaudeMdWrites: "project" },
    ...overrides,
  };
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "pi-claude-memory-inject-"));
  claudeDir = join(base, ".claude");
  repo = join(base, "repo");
  mkdirSync(join(repo, ".git"), { recursive: true });
  mkdirSync(claudeDir, { recursive: true });
  writeFileSync(join(claudeDir, "CLAUDE.md"), "# Global\nAlways run tests.\n");
  writeFileSync(join(repo, "CLAUDE.md"), "# Project\nUse pnpm.\n");
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe("buildMemoryBlock", () => {
  it("includes both context files and the memory index", () => {
    const dir = memoryDir(claudeDir, repo);
    writeMemory(dir, {
      title: "Branch naming",
      description: "No slashes",
      body: "Use dashes.",
      type: "feedback",
      hook: "previews break",
    });

    const block = buildMemoryBlock({ config: config(), cwd: repo });

    expect(block.text).toContain("Always run tests.");
    expect(block.text).toContain("Use pnpm.");
    expect(block.text).toContain("<memory_index");
    expect(block.text).toContain("Use dashes.");
  });

  it("skips a context file pi already loaded natively", () => {
    const block = buildMemoryBlock({
      config: config(),
      cwd: repo,
      nativeContextPaths: [join(repo, "CLAUDE.md")],
    });

    expect(block.text).toContain("Always run tests.");
    expect(block.text).not.toContain("Use pnpm.");
  });

  it("deduplicates a context file reached through a symlink", () => {
    const link = join(base, "agents-global.md");
    symlinkSync(join(claudeDir, "CLAUDE.md"), link);

    const block = buildMemoryBlock({ config: config(), cwd: repo, nativeContextPaths: [link] });

    expect(block.text).not.toContain("Always run tests.");
  });

  it("keeps index-only types out of the full bodies", () => {
    const dir = memoryDir(claudeDir, repo);
    writeMemory(dir, {
      title: "Virtualisation notes",
      description: "Draft PR notes",
      body: "Measurements pending.",
      type: "project",
      hook: "open question",
    });

    const block = buildMemoryBlock({ config: config(), cwd: repo });

    expect(block.text).toContain("Virtualisation notes");
    expect(block.text).not.toContain("Measurements pending.");
  });

  it("drops full bodies and warns when the budget is exceeded", () => {
    const dir = memoryDir(claudeDir, repo);
    writeMemory(dir, {
      title: "Long rule",
      description: "Long",
      body: "x".repeat(4000),
      type: "feedback",
      hook: "long",
    });

    const block = buildMemoryBlock({ config: config({ budget: { maxBytes: 1024, warnOnExceed: true } }), cwd: repo });

    expect(block.warnings).toHaveLength(1);
    expect(block.text).not.toContain("x".repeat(4000));
    expect(block.text).toContain("<memory_index");
  });

  it("reads memory from the main repository when run inside a worktree", () => {
    const worktree = join(base, "feature");
    const gitDir = join(repo, ".git", "worktrees", "feature");
    mkdirSync(gitDir, { recursive: true });
    writeFileSync(join(gitDir, "commondir"), "../..\n");
    mkdirSync(worktree, { recursive: true });
    writeFileSync(join(worktree, ".git"), `gitdir: ${gitDir}\n`);

    writeMemory(memoryDir(claudeDir, repo), {
      title: "Main repo rule",
      description: "Shared",
      body: "Applies everywhere.",
      type: "feedback",
      hook: "shared",
    });

    const block = buildMemoryBlock({ config: config(), cwd: worktree });

    expect(block.text).toContain("Applies everywhere.");
  });
});

describe("MemoryCache", () => {
  it("rebuilds after a memory is written", () => {
    const cache = new MemoryCache();
    const options = { config: config(), cwd: repo };

    expect(cache.get(options).text).not.toContain("Fresh rule");

    writeMemory(memoryDir(claudeDir, repo), {
      title: "Fresh rule",
      description: "Fresh",
      body: "Fresh rule body.",
      type: "feedback",
      hook: "fresh",
    });

    expect(cache.get(options).text).toContain("Fresh rule");
  });
});
