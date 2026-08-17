import { describe, expect, it } from "vitest";
import type { Config, GuardScope } from "../src/config.ts";
import { evaluateBash, evaluateWrite } from "../src/guard.ts";

const CWD = "/repo";

function config(scope: GuardScope): Config {
  return {
    claudeDir: "/home/user/.claude",
    scope: "gitRoot",
    inject: { full: ["feedback"], indexOnly: ["project"], projectContextFile: true, globalContextFile: true },
    budget: { maxBytes: 1000, warnOnExceed: true },
    guard: { blockClaudeMdWrites: scope },
  };
}

describe("evaluateWrite", () => {
  it("blocks project files but not the global file by default", () => {
    const active = config("project");

    expect(evaluateWrite(active, CWD, "/repo/CLAUDE.md").blocked).toBe(true);
    expect(evaluateWrite(active, CWD, "/home/user/.claude/CLAUDE.md").blocked).toBe(false);
  });

  it("blocks the global file only when scoped to global", () => {
    const active = config("global");

    expect(evaluateWrite(active, CWD, "/home/user/.claude/CLAUDE.md").blocked).toBe(true);
    expect(evaluateWrite(active, CWD, "/repo/CLAUDE.md").blocked).toBe(false);
  });

  it("blocks both scopes when set to all", () => {
    const active = config("all");

    expect(evaluateWrite(active, CWD, "/repo/CLAUDE.md").blocked).toBe(true);
    expect(evaluateWrite(active, CWD, "/home/user/.claude/CLAUDE.md").blocked).toBe(true);
  });

  it("allows everything when disabled", () => {
    expect(evaluateWrite(config("none"), CWD, "/repo/CLAUDE.md").blocked).toBe(false);
  });

  it("resolves relative paths against cwd", () => {
    expect(evaluateWrite(config("project"), CWD, "CLAUDE.md").blocked).toBe(true);
    expect(evaluateWrite(config("project"), CWD, "docs/CLAUDE.local.md").blocked).toBe(true);
  });

  it("ignores unrelated files", () => {
    expect(evaluateWrite(config("all"), CWD, "/repo/README.md").blocked).toBe(false);
    expect(evaluateWrite(config("all"), CWD, "/repo/CLAUDE.md.bak").blocked).toBe(false);
  });
});

describe("evaluateBash", () => {
  it("catches redirects into a guarded file", () => {
    expect(evaluateBash(config("project"), CWD, "echo rule >> CLAUDE.md").blocked).toBe(true);
    expect(evaluateBash(config("project"), CWD, "echo rule | tee -a /repo/CLAUDE.md").blocked).toBe(true);
    expect(evaluateBash(config("project"), CWD, 'echo rule > "/repo/CLAUDE.md"').blocked).toBe(true);
  });

  it("leaves ordinary commands alone", () => {
    expect(evaluateBash(config("all"), CWD, "cat CLAUDE.md").blocked).toBe(false);
    expect(evaluateBash(config("all"), CWD, "npm test > out.log").blocked).toBe(false);
  });
});
