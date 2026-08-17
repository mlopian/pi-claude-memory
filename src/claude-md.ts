import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface GlobalMemoryEntry {
  title: string;
  body: string;
}

export interface AppendResult {
  path: string;
  created: boolean;
  replaced: boolean;
}

function resolveTarget(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

function writeAtomic(path: string, content: string): void {
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(temporary, content, "utf-8");
  renameSync(temporary, path);
}

export function appendGlobalMemory(path: string, entry: GlobalMemoryEntry): AppendResult {
  const target = resolveTarget(path);
  const created = !existsSync(target);

  if (created) {
    mkdirSync(dirname(target), { recursive: true });
  }

  const existing = created ? "" : readFileSync(target, "utf-8");
  const section = `## ${entry.title}\n${entry.body.trim()}`;
  const sections = existing.trimEnd().split(/\n(?=## )/);
  const index = sections.findIndex((part) => part.startsWith(`## ${entry.title}\n`) || part.trim() === `## ${entry.title}`);

  if (index >= 0) {
    sections[index] = section;
    writeAtomic(target, `${sections.join("\n\n")}\n`);
    return { path: target, created, replaced: true };
  }

  const prefix = existing.trim() === "" ? "" : `${existing.trimEnd()}\n\n`;
  writeAtomic(target, `${prefix}${section}\n`);
  return { path: target, created, replaced: false };
}
