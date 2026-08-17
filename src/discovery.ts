import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

export interface RepoLocation {
  root: string;
  mainRoot: string | null;
}

function readGitdirPointer(gitFile: string): string | null {
  const raw = readFileSync(gitFile, "utf-8").trim();
  const match = /^gitdir:\s*(.+)$/.exec(raw);
  if (!match) {
    return null;
  }
  const target = match[1]!.trim();
  return isAbsolute(target) ? target : resolve(dirname(gitFile), target);
}

function mainRepoRootFromWorktree(gitDir: string): string | null {
  const commondirFile = join(gitDir, "commondir");
  if (!existsSync(commondirFile)) {
    return null;
  }
  const commondir = readFileSync(commondirFile, "utf-8").trim();
  if (!commondir) {
    return null;
  }
  const resolved = isAbsolute(commondir) ? commondir : resolve(gitDir, commondir);
  return dirname(resolved);
}

export function findRepo(startDir: string): RepoLocation | null {
  let current = resolve(startDir);

  for (;;) {
    const gitPath = join(current, ".git");
    if (existsSync(gitPath)) {
      const stats = statSync(gitPath);
      if (stats.isDirectory()) {
        return { root: current, mainRoot: null };
      }
      if (stats.isFile()) {
        const gitDir = readGitdirPointer(gitPath);
        const mainRoot = gitDir ? mainRepoRootFromWorktree(gitDir) : null;
        return { root: current, mainRoot: mainRoot === current ? null : mainRoot };
      }
    }

    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

export function writeScopePath(cwd: string, scope: "gitRoot" | "cwd"): string {
  if (scope === "cwd") {
    return resolve(cwd);
  }
  return findRepo(cwd)?.root ?? resolve(cwd);
}

export function readScopePaths(cwd: string): string[] {
  const paths = [resolve(cwd)];
  const repo = findRepo(cwd);

  if (repo) {
    paths.push(repo.root);
    if (repo.mainRoot) {
      paths.push(repo.mainRoot);
    }
  }

  return [...new Set(paths)];
}

export function projectContextFile(cwd: string): string | null {
  const repo = findRepo(cwd);
  const root = repo?.root ?? resolve(cwd);
  const candidate = join(root, "CLAUDE.md");
  return existsSync(candidate) ? candidate : null;
}
