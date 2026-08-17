import type { Api, Context, Model, Provider } from "@earendil-works/pi-ai";
import type { MemoryType } from "./config.ts";

export interface DistilledMemory {
  title: string;
  description: string;
  body: string;
  hook: string;
}

export interface DistillDeps {
  model: Model<Api>;
  provider: Provider<Api>;
  auth?: { apiKey?: string; headers?: Record<string, string> };
  signal?: AbortSignal;
  transcript: string;
  type: MemoryType;
  scope: "project" | "global";
}

const SYSTEM_PROMPT = [
  "You distill one durable memory from a coding session transcript.",
  "Return a single JSON object and nothing else, with these string fields:",
  '"title" (short noun phrase, max 8 words), "description" (one sentence, max 160 characters),',
  '"body" (the memory itself in markdown, 1-6 lines), "hook" (max 100 characters, the reason this matters).',
  "Write in the language the user used in the transcript. State the fact, not the conversation around it.",
].join("\n");

function instructionFor(scope: "project" | "global", type: MemoryType): string {
  const target = scope === "global" ? "a global rule that applies to every project" : `a project memory of type "${type}"`;
  const shape =
    type === "feedback" || type === "project"
      ? ' The body must end with a "**Why:**" line and a "**How to apply:**" line.'
      : "";
  return `Distill ${target} from the transcript below.${shape}`;
}

function preview(text: string): string {
  const collapsed = text.replaceAll(/\s+/g, " ").trim();
  if (collapsed === "") {
    return "<empty>";
  }
  return collapsed.length <= 200 ? collapsed : `${collapsed.slice(0, 200)}...`;
}

function extractJson(text: string): DistilledMemory {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = (fenced ? fenced[1]! : text).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");

  if (start < 0 || end <= start) {
    throw new Error(`The model did not return a JSON object. Response: ${preview(text)}`);
  }

  const parsed: unknown = JSON.parse(candidate.slice(start, end + 1));
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`The model did not return a JSON object. Response: ${preview(text)}`);
  }

  const record = parsed as Record<string, unknown>;
  const fields = ["title", "description", "body", "hook"] as const;

  for (const field of fields) {
    if (typeof record[field] !== "string" || (record[field] as string).trim() === "") {
      throw new Error(`The model response is missing "${field}"`);
    }
  }

  return {
    title: (record.title as string).trim(),
    description: (record.description as string).trim(),
    body: (record.body as string).trim(),
    hook: (record.hook as string).trim(),
  };
}

function messageText(message: unknown): string {
  const content = (message as { content?: unknown }).content;

  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .filter((part): part is { type: string; text: string } => {
        const candidate = part as { type?: unknown; text?: unknown };
        return candidate.type === "text" && typeof candidate.text === "string";
      })
      .map((part) => part.text)
      .join("");
  }

  return "";
}

export async function distillMemory(deps: DistillDeps): Promise<DistilledMemory> {
  const context: Context = {
    systemPrompt: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `${instructionFor(deps.scope, deps.type)}\n\n<transcript>\n${deps.transcript}\n</transcript>`,
        timestamp: Date.now(),
      },
    ],
    tools: [],
  };

  const stream = deps.provider.stream(deps.model, context, {
    apiKey: deps.auth?.apiKey,
    headers: deps.auth?.headers,
    signal: deps.signal,
    maxTokens: 8192,
    temperature: 0,
  });

  return extractJson(messageText(await stream.result()));
}
