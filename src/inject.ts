import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";
import { globalContextFile, type Config } from "./config.ts";
import { projectContextFile, readScopePaths } from "./discovery.ts";
import { listMemories, readIndex } from "./memory-store.ts";
import { memoryDir } from "./slug.ts";

export interface MemoryBlock {
  text: string;
  bytes: number;
  warnings: string[];
  sources: string[];
}

const OPEN_TAG = "<claude_memory>";
const CLOSE_TAG = "</claude_memory>";

const USAGE_NOTE = [
  "Shared memory loaded from Claude Code. These instructions are authoritative for this session.",
  "Project memories live in the memory directories listed below; write new ones with /remember, never by editing those files directly.",
  "Global rules live in the global CLAUDE.md; write new ones with /remember-globally.",
].join("\n");

function canonical(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

function readFileSection(label: string, path: string): string {
  return `<memory_file path="${path}" source="${label}">\n${readFileSync(path, "utf-8").trim()}\n</memory_file>`;
}

function fingerprint(paths: string[]): string {
  return paths
    .map((path) => {
      try {
        const stats = statSync(path);
        return `${path}:${stats.mtimeMs}:${stats.size}`;
      } catch {
        return `${path}:missing`;
      }
    })
    .join("|");
}

export interface BuildOptions {
  config: Config;
  cwd: string;
  nativeContextPaths?: string[];
}

export function memoryDirsFor(config: Config, cwd: string): string[] {
  const seen = new Set<string>();
  const dirs: string[] = [];

  for (const scopePath of readScopePaths(cwd)) {
    const dir = memoryDir(config.claudeDir, scopePath);
    const key = canonical(dir);
    if (!seen.has(key) && existsSync(dir)) {
      seen.add(key);
      dirs.push(dir);
    }
  }

  return dirs;
}

export function collectSources(config: Config, cwd: string): string[] {
  const sources: string[] = [];
  const globalFile = globalContextFile(config);

  if (config.inject.globalContextFile && existsSync(globalFile)) {
    sources.push(globalFile);
  }

  if (config.inject.projectContextFile) {
    const projectFile = projectContextFile(cwd);
    if (projectFile) {
      sources.push(projectFile);
    }
  }

  for (const dir of memoryDirsFor(config, cwd)) {
    sources.push(join(dir, "MEMORY.md"));
    for (const doc of listMemories(dir)) {
      sources.push(doc.path);
    }
  }

  return sources;
}

export function buildMemoryBlock(options: BuildOptions): MemoryBlock {
  const { config, cwd } = options;
  const native = new Set((options.nativeContextPaths ?? []).map(canonical));
  const warnings: string[] = [];
  const sources: string[] = [];
  const parts: string[] = [USAGE_NOTE];

  const globalFile = globalContextFile(config);
  if (config.inject.globalContextFile && existsSync(globalFile) && !native.has(canonical(globalFile))) {
    parts.push(readFileSection("global", globalFile));
    sources.push(globalFile);
  }

  if (config.inject.projectContextFile) {
    const projectFile = projectContextFile(cwd);
    if (projectFile && !native.has(canonical(projectFile))) {
      parts.push(readFileSection("project", projectFile));
      sources.push(projectFile);
    }
  }

  const indexParts: string[] = [];
  const fullParts: string[] = [];

  for (const dir of memoryDirsFor(config, cwd)) {
    const index = readIndex(dir);
    if (index) {
      indexParts.push(`<memory_index dir="${dir}">\n${index}\n</memory_index>`);
      sources.push(join(dir, "MEMORY.md"));
    }

    for (const doc of listMemories(dir)) {
      sources.push(doc.path);
      if (config.inject.full.includes(doc.type as never)) {
        fullParts.push(`<memory name="${doc.name}" type="${doc.type}" path="${doc.path}">\n${doc.body}\n</memory>`);
      }
    }
  }

  parts.push(...indexParts);

  const withoutFull = [OPEN_TAG, parts.join("\n\n"), CLOSE_TAG].join("\n");
  const withFull = [OPEN_TAG, [...parts, ...fullParts].join("\n\n"), CLOSE_TAG].join("\n");
  const fullBytes = Buffer.byteLength(withFull, "utf-8");

  if (fullBytes <= config.budget.maxBytes || fullParts.length === 0) {
    return { text: withFull, bytes: fullBytes, warnings, sources };
  }

  warnings.push(
    `Memory budget exceeded (${fullBytes} B > ${config.budget.maxBytes} B). Injected the index only; the model can still read individual memory files.`,
  );

  const text = withoutFull;
  return { text, bytes: Buffer.byteLength(text, "utf-8"), warnings, sources };
}

export class MemoryCache {
  private key = "";
  private block: MemoryBlock | null = null;

  get(options: BuildOptions): MemoryBlock {
    const key = fingerprint([...collectSources(options.config, options.cwd), options.cwd]);
    if (this.block && key === this.key) {
      return this.block;
    }

    const block = buildMemoryBlock(options);
    this.key = key;
    this.block = block;
    return block;
  }

  invalidate(): void {
    this.key = "";
    this.block = null;
  }
}
