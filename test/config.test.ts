import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.ts";
import { draftFromText, parseArgs } from "../src/command.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pi-claude-memory-config-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeConfig(name: string, value: unknown): string {
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify(value));
  return path;
}

describe("loadConfig", () => {
  it("defaults to blocking project writes only", () => {
    const config = loadConfig({ globalConfigPath: join(dir, "missing.json"), env: {} });

    expect(config.guard.blockClaudeMdWrites).toBe("project");
    expect(config.inject.full).toEqual(["feedback", "user"]);
  });

  it("honours CLAUDE_CONFIG_DIR", () => {
    const config = loadConfig({
      globalConfigPath: join(dir, "missing.json"),
      env: { CLAUDE_CONFIG_DIR: "/elsewhere/.claude" },
    });

    expect(config.claudeDir).toBe("/elsewhere/.claude");
  });

  it("lets the project config override the global one", () => {
    const global = writeConfig("global.json", { guard: { blockClaudeMdWrites: "all" }, scope: "cwd" });
    const project = writeConfig("project.json", { guard: { blockClaudeMdWrites: "none" } });

    const config = loadConfig({ globalConfigPath: global, projectConfigPath: project, env: {} });

    expect(config.guard.blockClaudeMdWrites).toBe("none");
    expect(config.scope).toBe("cwd");
  });

  it("ignores invalid values instead of failing", () => {
    const global = writeConfig("global.json", {
      guard: { blockClaudeMdWrites: "sometimes" },
      inject: { full: ["feedback", "nonsense"] },
      budget: { maxBytes: -5 },
    });

    const config = loadConfig({ globalConfigPath: global, env: {} });

    expect(config.guard.blockClaudeMdWrites).toBe("project");
    expect(config.inject.full).toEqual(["feedback", "user"]);
    expect(config.budget.maxBytes).toBe(65536);
  });

  it("survives malformed JSON", () => {
    const path = join(dir, "broken.json");
    writeFileSync(path, "{ not json");

    expect(loadConfig({ globalConfigPath: path, env: {} }).scope).toBe("gitRoot");
  });
});

describe("parseArgs", () => {
  it("reads an inline type flag", () => {
    expect(parseArgs("--type=project remember this")).toEqual({ type: "project", text: "remember this" });
  });

  it("reads a separated type flag", () => {
    expect(parseArgs("--type reference see the dashboard")).toEqual({
      type: "reference",
      text: "see the dashboard",
    });
  });

  it("defaults to no type when the flag is absent", () => {
    expect(parseArgs("plain text")).toEqual({ type: null, text: "plain text" });
  });

  it("rejects an unknown type", () => {
    expect(parseArgs("--type=nonsense text").error).toContain("Unknown memory type");
  });

  it("returns empty text when only a flag is given", () => {
    expect(parseArgs("--type=project")).toEqual({ type: "project", text: "" });
  });
});

describe("draftFromText", () => {
  it("derives a title, description and hook from the first sentence", () => {
    const draft = draftFromText("Never use em dashes. They read as generated text.", "feedback", "s1");

    expect(draft.title).toBe("Never use em dashes");
    expect(draft.description).toBe("Never use em dashes");
    expect(draft.body).toBe("Never use em dashes. They read as generated text.");
    expect(draft.sessionId).toBe("s1");
  });

  it("truncates a long title at a word boundary", () => {
    const draft = draftFromText("word ".repeat(40), "feedback", null);

    expect(draft.title.length).toBeLessThanOrEqual(60);
    expect(draft.title.endsWith("word...")).toBe(true);
    expect(draft.description.length).toBeLessThanOrEqual(160);
  });

  it("keeps a sentence that fits whole", () => {
    const draft = draftFromText("Never add Claude attribution to commits or PR descriptions.", "feedback", null);

    expect(draft.title).toBe("Never add Claude attribution to commits or PR descriptions");
  });
});
