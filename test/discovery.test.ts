import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findRepo, projectContextFile, readScopePaths, writeScopePath } from "../src/discovery.ts";

let base: string;

function makeRepo(name: string): string {
  const root = join(base, name);
  mkdirSync(join(root, ".git"), { recursive: true });
  return root;
}

function makeWorktree(mainRoot: string, name: string): string {
  const gitDir = join(mainRoot, ".git", "worktrees", name);
  mkdirSync(gitDir, { recursive: true });
  writeFileSync(join(gitDir, "commondir"), "../..\n");

  const root = join(base, name);
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, ".git"), `gitdir: ${gitDir}\n`);
  return root;
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "pi-claude-memory-repo-"));
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe("findRepo", () => {
  it("walks up to the repository root", () => {
    const root = makeRepo("app");
    const nested = join(root, "packages", "web");
    mkdirSync(nested, { recursive: true });

    expect(findRepo(nested)?.root).toBe(root);
  });

  it("returns null outside a repository", () => {
    expect(findRepo(base)).toBeNull();
  });

  it("resolves the main repository behind a worktree", () => {
    const mainRoot = makeRepo("app");
    const worktree = makeWorktree(mainRoot, "feature");

    expect(findRepo(worktree)).toEqual({ root: worktree, mainRoot });
  });
});

describe("scopes", () => {
  it("writes to the repository root by default", () => {
    const root = makeRepo("app");
    const nested = join(root, "packages", "web");
    mkdirSync(nested, { recursive: true });

    expect(writeScopePath(nested, "gitRoot")).toBe(root);
    expect(writeScopePath(nested, "cwd")).toBe(nested);
  });

  it("falls back to cwd outside a repository", () => {
    expect(writeScopePath(base, "gitRoot")).toBe(base);
  });

  it("reads from cwd, repository root and main repository", () => {
    const mainRoot = makeRepo("app");
    const worktree = makeWorktree(mainRoot, "feature");
    const nested = join(worktree, "packages", "web");
    mkdirSync(nested, { recursive: true });

    expect(readScopePaths(nested)).toEqual([nested, worktree, mainRoot]);
  });

  it("deduplicates when cwd is the repository root", () => {
    const root = makeRepo("app");

    expect(readScopePaths(root)).toEqual([root]);
  });
});

describe("projectContextFile", () => {
  it("finds CLAUDE.md at the repository root", () => {
    const root = makeRepo("app");
    writeFileSync(join(root, "CLAUDE.md"), "rules\n");
    const nested = join(root, "src");
    mkdirSync(nested, { recursive: true });

    expect(projectContextFile(nested)).toBe(join(root, "CLAUDE.md"));
  });

  it("returns null when the repository has no CLAUDE.md", () => {
    expect(projectContextFile(makeRepo("app"))).toBeNull();
  });
});
