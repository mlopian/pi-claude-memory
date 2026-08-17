import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { MemoryType } from "./config.ts";

export interface MemoryDoc {
  path: string;
  name: string;
  description: string;
  type: string;
  body: string;
  bytes: number;
}

export interface MemoryDraft {
  title: string;
  description: string;
  body: string;
  type: MemoryType;
  hook: string;
  sessionId?: string | null;
}

export interface WriteResult {
  path: string;
  name: string;
  created: boolean;
}

const INDEX_FILENAME = "MEMORY.md";
const INDEX_HEADER = "# Project Memory";
const INDEX_SEPARATOR = " — ";

interface Frontmatter {
  fields: [string, string][];
  metadata: [string, string][];
}

interface ParsedMemory {
  frontmatter: Frontmatter;
  body: string;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replaceAll('\\"', '"');
  }
  return trimmed;
}

function quote(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

function needsQuoting(key: string, value: string): boolean {
  return (
    key === "description" ||
    value.includes(": ") ||
    value.includes(" #") ||
    value.endsWith(":") ||
    value.trim() !== value ||
    value === "" ||
    /^[-?:,[\]{}&*!|>'"%@`]/.test(value)
  );
}

export function parseMemory(text: string): ParsedMemory {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!match) {
    return { frontmatter: { fields: [], metadata: [] }, body: text.trim() };
  }

  const fields: [string, string][] = [];
  const metadata: [string, string][] = [];
  let inMetadata = false;

  for (const line of match[1]!.split(/\r?\n/)) {
    if (line.trim() === "") {
      continue;
    }
    const indented = /^\s+/.test(line);
    const pair = /^\s*([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (!pair) {
      continue;
    }
    const key = pair[1]!;
    const value = pair[2]!;

    if (indented && inMetadata) {
      metadata.push([key, unquote(value)]);
      continue;
    }

    inMetadata = key === "metadata" && value.trim() === "";
    if (!inMetadata) {
      fields.push([key, unquote(value)]);
    }
  }

  return { frontmatter: { fields, metadata }, body: text.slice(match[0].length).trim() };
}

export function serializeMemory(parsed: ParsedMemory): string {
  const lines = ["---"];

  for (const [key, value] of parsed.frontmatter.fields) {
    lines.push(`${key}: ${needsQuoting(key, value) ? quote(value) : value}`);
  }

  if (parsed.frontmatter.metadata.length > 0) {
    lines.push("metadata:");
    for (const [key, value] of parsed.frontmatter.metadata) {
      lines.push(`  ${key}: ${needsQuoting(key, value) ? quote(value) : value}`);
    }
  }

  lines.push("---", "", parsed.body.trim(), "");
  return lines.join("\n");
}

export function slugify(value: string): string {
  const ascii = value
    .normalize("NFD")
    .replaceAll(/[\u0300-\u036f]/g, "")
    .replaceAll("ł", "l")
    .replaceAll("Ł", "L");

  return ascii
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
    .slice(0, 60)
    .replaceAll(/-+$/g, "");
}

export function memoryName(type: MemoryType, title: string): string {
  const slug = slugify(title);
  return slug.startsWith(`${type}-`) ? slug : `${type}-${slug}`;
}

export function memoryFilename(name: string): string {
  return `${name.replaceAll("-", "_")}.md`;
}

function setField(fields: [string, string][], key: string, value: string): void {
  const existing = fields.find((entry) => entry[0] === key);
  if (existing) {
    existing[1] = value;
    return;
  }
  fields.push([key, value]);
}

export function listMemories(dir: string): MemoryDoc[] {
  if (!existsSync(dir)) {
    return [];
  }

  const docs: MemoryDoc[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".md") || entry.name === INDEX_FILENAME) {
      continue;
    }

    const path = join(dir, entry.name);
    const raw = readFileSync(path, "utf-8");
    const parsed = parseMemory(raw);
    const fields = new Map(parsed.frontmatter.fields);
    const metadata = new Map(parsed.frontmatter.metadata);

    docs.push({
      path,
      name: fields.get("name") ?? entry.name.replace(/\.md$/, "").replaceAll("_", "-"),
      description: fields.get("description") ?? "",
      type: metadata.get("type") ?? "unknown",
      body: parsed.body,
      bytes: Buffer.byteLength(raw, "utf-8"),
    });
  }

  return docs.sort((left, right) => left.name.localeCompare(right.name));
}

function writeAtomic(path: string, content: string): void {
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(temporary, content, "utf-8");
  renameSync(temporary, path);
}

export function writeMemory(dir: string, draft: MemoryDraft): WriteResult {
  mkdirSync(dir, { recursive: true });

  const name = memoryName(draft.type, draft.title);
  const path = join(dir, memoryFilename(name));
  const created = !existsSync(path);
  const parsed: ParsedMemory = created
    ? { frontmatter: { fields: [], metadata: [] }, body: "" }
    : parseMemory(readFileSync(path, "utf-8"));

  setField(parsed.frontmatter.fields, "name", name);
  setField(parsed.frontmatter.fields, "description", draft.description);
  setField(parsed.frontmatter.metadata, "node_type", "memory");
  setField(parsed.frontmatter.metadata, "type", draft.type);
  if (draft.sessionId && !parsed.frontmatter.metadata.some((entry) => entry[0] === "originSessionId")) {
    setField(parsed.frontmatter.metadata, "originSessionId", draft.sessionId);
  }
  setField(parsed.frontmatter.metadata, "modified", new Date().toISOString());
  parsed.body = draft.body.trim();

  writeAtomic(path, serializeMemory(parsed));
  updateIndex(dir, { title: draft.title, filename: basename(path), hook: draft.hook });

  return { path, name, created };
}

export interface IndexEntry {
  title: string;
  filename: string;
  hook: string;
}

function indexSections(text: string): string[] {
  const parts = text.split(/\n(?=## )/);
  return parts.map((part) => part.replace(/\s+$/, ""));
}

export function updateIndex(dir: string, entry: IndexEntry): void {
  const path = join(dir, INDEX_FILENAME);
  const existing = existsSync(path) ? readFileSync(path, "utf-8") : `${INDEX_HEADER}\n`;
  const link = `[${entry.filename}](${entry.filename})`;
  const section = `## ${entry.title}\n${link}${entry.hook ? `${INDEX_SEPARATOR}${entry.hook}` : ""}`;

  const sections = indexSections(existing.trimEnd());
  const index = sections.findIndex((part) => part.startsWith("## ") && part.includes(link));

  if (index >= 0) {
    sections[index] = section;
  } else {
    sections.push(section);
  }

  writeAtomic(path, `${sections.join("\n\n")}\n`);
}

export function readIndex(dir: string): string | null {
  const path = join(dir, INDEX_FILENAME);
  return existsSync(path) ? readFileSync(path, "utf-8").trim() : null;
}
