import { existsSync, readdirSync } from "node:fs";
import { join, resolve, sep } from "node:path";

export interface ProjectDirResolution {
  dir: string;
  slug: string;
  existed: boolean;
}

function normalizePath(projectPath: string): string {
  const absolute = resolve(projectPath);
  if (absolute.length > 1 && absolute.endsWith(sep)) {
    return absolute.slice(0, -1);
  }
  return absolute;
}

export function encodeProjectSlug(projectPath: string): string {
  return normalizePath(projectPath).replaceAll(/[/.]/g, "-");
}

function encodeCandidates(projectPath: string): string[] {
  const primary = encodeProjectSlug(projectPath);
  const permissive = normalizePath(projectPath).replaceAll(/[^A-Za-z0-9-]/g, "-");
  return primary === permissive ? [primary] : [primary, permissive];
}

export function projectsRoot(claudeDir: string): string {
  return join(claudeDir, "projects");
}

export function resolveProjectDir(claudeDir: string, projectPath: string): ProjectDirResolution {
  const root = projectsRoot(claudeDir);
  const candidates = encodeCandidates(projectPath);

  for (const slug of candidates) {
    const dir = join(root, slug);
    if (existsSync(dir)) {
      return { dir, slug, existed: true };
    }
  }

  const primary = candidates[0]!;
  const lowered = primary.toLowerCase();
  if (existsSync(root)) {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.toLowerCase() === lowered) {
        return { dir: join(root, entry.name), slug: entry.name, existed: true };
      }
    }
  }

  return { dir: join(root, primary), slug: primary, existed: false };
}

export function memoryDir(claudeDir: string, projectPath: string): string {
  return join(resolveProjectDir(claudeDir, projectPath).dir, "memory");
}
