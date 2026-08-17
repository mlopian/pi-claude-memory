import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  listMemories,
  memoryFilename,
  memoryName,
  parseMemory,
  readIndex,
  serializeMemory,
  slugify,
  writeMemory,
} from "../src/memory-store.ts";

const SAMPLE = `---
name: feedback-branch-naming-no-slash
description: "Never create branches with a slash"
metadata:
  node_type: memory
  type: feedback
  originSessionId: a4ac9f9c
  modified: 2026-07-31T12:40:24.824Z
---

Branch names must not contain a slash.

**Why:** slashes break preview environments.
`;

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pi-claude-memory-store-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("parseMemory", () => {
  it("reads fields, metadata and body", () => {
    const parsed = parseMemory(SAMPLE);

    expect(parsed.frontmatter.fields).toEqual([
      ["name", "feedback-branch-naming-no-slash"],
      ["description", "Never create branches with a slash"],
    ]);
    expect(new Map(parsed.frontmatter.metadata).get("type")).toBe("feedback");
    expect(parsed.body).toContain("**Why:**");
  });

  it("round-trips without losing unknown metadata", () => {
    const parsed = parseMemory(SAMPLE);
    const reparsed = parseMemory(serializeMemory(parsed));

    expect(new Map(reparsed.frontmatter.metadata).get("originSessionId")).toBe("a4ac9f9c");
  });

  it("treats a file without frontmatter as body only", () => {
    expect(parseMemory("just text").body).toBe("just text");
  });
});

describe("naming", () => {
  it("strips diacritics", () => {
    expect(slugify("Nie używaj pauzy w opisach")).toBe("nie-uzywaj-pauzy-w-opisach");
  });

  it("prefixes the name with the type once", () => {
    expect(memoryName("feedback", "Branch naming")).toBe("feedback-branch-naming");
    expect(memoryName("feedback", "feedback branch naming")).toBe("feedback-branch-naming");
  });

  it("maps the name to an underscore filename", () => {
    expect(memoryFilename("feedback-branch-naming")).toBe("feedback_branch_naming.md");
  });
});

describe("writeMemory", () => {
  const draft = {
    title: "Branch naming",
    description: "Branches must not contain a slash",
    body: "Use dashes.\n\n**Why:** slashes break previews.",
    type: "feedback" as const,
    hook: "slashes break previews",
    sessionId: "session-1",
  };

  it("creates the file and the index entry", () => {
    const result = writeMemory(dir, draft);

    expect(result.created).toBe(true);
    expect(readFileSync(result.path, "utf-8")).toContain("node_type: memory");
    expect(readIndex(dir)).toContain("[feedback_branch_naming.md](feedback_branch_naming.md)");
  });

  it("updates instead of duplicating and keeps the original session id", () => {
    const first = writeMemory(dir, draft);
    const second = writeMemory(dir, { ...draft, description: "Updated", sessionId: "session-2" });

    expect(second.created).toBe(false);
    expect(second.path).toBe(first.path);
    expect(listMemories(dir)).toHaveLength(1);

    const stored = readFileSync(second.path, "utf-8");
    expect(stored).toContain("originSessionId: session-1");
    expect(stored).toContain('description: "Updated"');
    expect(stored).toContain("modified: 20");
  });

  it("replaces the matching index section instead of appending a second one", () => {
    writeMemory(dir, draft);
    writeMemory(dir, { ...draft, title: "Branch naming", hook: "new hook" });

    const index = readIndex(dir) ?? "";
    expect(index.match(/feedback_branch_naming\.md/g)).toHaveLength(2);
    expect(index).toContain("new hook");
  });

  it("preserves unrelated index sections", () => {
    writeFileSync(join(dir, "MEMORY.md"), "# Project Memory\n\n## Existing\n[other.md](other.md) — kept\n");
    writeMemory(dir, draft);

    const index = readIndex(dir) ?? "";
    expect(index).toContain("## Existing");
    expect(index).toContain("## Branch naming");
  });
});

describe("listMemories", () => {
  it("skips the index and reports the type", () => {
    writeFileSync(join(dir, "feedback_sample.md"), SAMPLE);
    writeFileSync(join(dir, "MEMORY.md"), "# Project Memory\n");

    const docs = listMemories(dir);

    expect(docs).toHaveLength(1);
    expect(docs[0]?.type).toBe("feedback");
  });

  it("returns nothing for a missing directory", () => {
    expect(listMemories(join(dir, "missing"))).toEqual([]);
  });
});
