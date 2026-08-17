import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { appendGlobalMemory } from "../src/claude-md.ts";
import { draftFromText, parseArgs, truncate } from "../src/command.ts";
import { CONFIG_FILENAME, globalContextFile, loadConfig, type Config, type MemoryType } from "../src/config.ts";
import { writeScopePath } from "../src/discovery.ts";
import { distillMemory, type DistilledMemory } from "../src/distill.ts";
import { MemoryCache } from "../src/inject.ts";
import { writeMemory } from "../src/memory-store.ts";
import { evaluateBash, evaluateWrite } from "../src/guard.ts";
import { memoryDir } from "../src/slug.ts";

const GLOBAL_CONFIG_PATH = join(homedir(), ".pi", "agent", CONFIG_FILENAME);
const TRANSCRIPT_ENTRIES = 12;

export default function (pi: ExtensionAPI) {
  const cache = new MemoryCache();
  let config: Config | null = null;

  function configFor(ctx: ExtensionContext): Config {
    if (!config) {
      config = loadConfig({
        globalConfigPath: GLOBAL_CONFIG_PATH,
        projectConfigPath: ctx.isProjectTrusted() ? join(ctx.cwd, ".pi", CONFIG_FILENAME) : null,
      });
    }
    return config;
  }

  pi.on("session_start", (_event, ctx) => {
    config = null;
    cache.invalidate();
    configFor(ctx);
  });

  pi.on("before_agent_start", (event, ctx) => {
    const active = configFor(ctx);
    const nativeContextPaths = (event.systemPromptOptions?.contextFiles ?? [])
      .map((file: { path?: string }) => file.path)
      .filter((path: string | undefined): path is string => typeof path === "string");

    const block = cache.get({ config: active, cwd: ctx.cwd, nativeContextPaths });

    if (block.warnings.length > 0 && active.budget.warnOnExceed && ctx.hasUI) {
      for (const warning of block.warnings) {
        ctx.ui.notify(warning, "warning");
      }
    }

    return { systemPrompt: `${event.systemPrompt}\n\n${block.text}` };
  });

  pi.on("tool_call", (event, ctx) => {
    const active = configFor(ctx);

    if (event.toolName === "write" || event.toolName === "edit") {
      const path = (event.input as { path?: string }).path ?? "";
      const decision = evaluateWrite(active, ctx.cwd, path);
      if (decision.blocked) {
        return { block: true, reason: decision.reason };
      }
    }

    if (event.toolName === "bash") {
      const command = (event.input as { command?: string }).command ?? "";
      const decision = evaluateBash(active, ctx.cwd, command);
      if (decision.blocked) {
        return { block: true, reason: decision.reason };
      }
    }

    return undefined;
  });

  function transcript(ctx: ExtensionContext): string {
    const entries = ctx.sessionManager.getEntries().slice(-TRANSCRIPT_ENTRIES);

    return entries
      .map((entry) => {
        const message = (entry as { message?: { role?: string; content?: unknown } }).message;
        if (!message?.role) {
          return "";
        }
        const content = Array.isArray(message.content)
          ? message.content
              .map((part) => (typeof part === "string" ? part : ((part as { text?: string }).text ?? "")))
              .join("")
          : String(message.content ?? "");
        return content.trim() === "" ? "" : `${message.role}: ${content.trim()}`;
      })
      .filter((line) => line !== "")
      .join("\n\n");
  }

  async function distill(
    ctx: ExtensionCommandContext,
    scope: "project" | "global",
    type: MemoryType,
  ): Promise<DistilledMemory> {
    const model = ctx.model;
    const provider = model ? ctx.modelRegistry.getProvider(model.provider) : undefined;

    if (!model || !provider) {
      throw new Error("No active model is available to distill a memory. Pass the memory text inline instead.");
    }

    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);

    return distillMemory({
      model,
      provider,
      auth: auth?.ok ? { apiKey: auth.apiKey, headers: auth.headers } : undefined,
      signal: ctx.signal,
      transcript: transcript(ctx),
      type,
      scope,
    });
  }

  async function resolveDraft(
    ctx: ExtensionCommandContext,
    args: string,
    scope: "project" | "global",
  ): Promise<{ type: MemoryType; title: string; description: string; body: string; hook: string } | null> {
    const parsed = parseArgs(args);

    if (parsed.error) {
      ctx.ui.notify(parsed.error, "error");
      return null;
    }

    const type = parsed.type ?? "feedback";

    if (parsed.text !== "") {
      const draft = draftFromText(parsed.text, type, ctx.sessionManager.getSessionId());
      return { ...draft, type };
    }

    if (!ctx.hasUI) {
      ctx.ui.notify("Nothing to remember. Pass the memory text inline, for example /remember <text>.", "error");
      return null;
    }

    const distilled = await distill(ctx, scope, type);
    const preview = [
      `Title: ${distilled.title}`,
      `Description: ${distilled.description}`,
      "",
      distilled.body,
    ].join("\n");

    const confirmed = await ctx.ui.confirm("Save this memory?", preview);
    return confirmed ? { ...distilled, type } : null;
  }

  pi.registerCommand("remember", {
    description: "Save a project memory to the Claude Code memory directory",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const active = configFor(ctx);
      const draft = await resolveDraft(ctx, args, "project");
      if (!draft) {
        return;
      }

      const dir = memoryDir(active.claudeDir, writeScopePath(ctx.cwd, active.scope));
      const result = writeMemory(dir, { ...draft, sessionId: ctx.sessionManager.getSessionId() });
      cache.invalidate();

      ctx.ui.notify(`${result.created ? "Saved" : "Updated"} ${result.path}`, "info");
    },
  });

  pi.registerCommand("remember-globally", {
    description: "Save a global rule to the Claude Code global CLAUDE.md",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const active = configFor(ctx);
      const draft = await resolveDraft(ctx, args, "global");
      if (!draft) {
        return;
      }

      const result = appendGlobalMemory(globalContextFile(active), {
        title: draft.title,
        body: draft.body,
      });
      cache.invalidate();

      ctx.ui.notify(
        `${result.replaced ? "Replaced section in" : "Appended to"} ${result.path}: ${truncate(draft.title, 60)}`,
        "info",
      );
    },
  });
}
