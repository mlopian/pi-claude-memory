import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { encodeProjectSlug, memoryDir, resolveProjectDir } from "../src/slug.ts";

describe("encodeProjectSlug", () => {
  it("replaces separators with dashes", () => {
    expect(encodeProjectSlug("/Users/maciek/Workspace/repos/dashboard-workflows")).toBe(
      "-Users-maciek-Workspace-repos-dashboard-workflows",
    );
  });

  it("replaces dots with dashes", () => {
    expect(encodeProjectSlug("/Users/maciek/Workspace/repos/registries.io")).toBe(
      "-Users-maciek-Workspace-repos-registries-io",
    );
  });

  it("collapses a leading dot directory into a double dash", () => {
    expect(encodeProjectSlug("/Users/maciek/.config/nvim")).toBe("-Users-maciek--config-nvim");
  });

  it("ignores a trailing separator", () => {
    expect(encodeProjectSlug("/Users/maciek/repo/")).toBe(encodeProjectSlug("/Users/maciek/repo"));
  });
});

describe("resolveProjectDir", () => {
  let claudeDir: string;

  beforeEach(() => {
    claudeDir = mkdtempSync(join(tmpdir(), "pi-claude-memory-"));
  });

  afterEach(() => {
    rmSync(claudeDir, { recursive: true, force: true });
  });

  it("reports a missing directory without creating it", () => {
    const resolution = resolveProjectDir(claudeDir, "/Users/maciek/repo");

    expect(resolution.existed).toBe(false);
    expect(resolution.slug).toBe("-Users-maciek-repo");
  });

  it("prefers an existing directory", () => {
    const slug = "-Users-maciek-repo";
    mkdirSync(join(claudeDir, "projects", slug), { recursive: true });

    expect(resolveProjectDir(claudeDir, "/Users/maciek/repo").existed).toBe(true);
  });

  it("falls back to a permissive encoding when the primary slug is missing", () => {
    const slug = "-Users-maciek-my-repo";
    mkdirSync(join(claudeDir, "projects", slug), { recursive: true });

    const resolution = resolveProjectDir(claudeDir, "/Users/maciek/my repo");

    expect(resolution.slug).toBe(slug);
    expect(resolution.existed).toBe(true);
  });

  it("points at the memory subdirectory", () => {
    expect(memoryDir(claudeDir, "/Users/maciek/repo")).toBe(
      join(claudeDir, "projects", "-Users-maciek-repo", "memory"),
    );
  });
});
