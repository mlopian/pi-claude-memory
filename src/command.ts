import { MEMORY_TYPES, type MemoryType } from "./config.ts";
import type { MemoryDraft } from "./memory-store.ts";

export interface ParsedArgs {
  type: MemoryType | null;
  text: string;
  error?: string;
}

function isMemoryType(value: string): value is MemoryType {
  return MEMORY_TYPES.includes(value as MemoryType);
}

export function parseArgs(raw: string): ParsedArgs {
  const tokens = raw.trim().split(/\s+/).filter((token) => token.length > 0);
  let type: MemoryType | null = null;
  let index = 0;

  while (index < tokens.length) {
    const match = /^--type(?:=(.*))?$/.exec(tokens[index]!);
    if (!match) {
      break;
    }

    const inline = match[1];
    const value = inline ?? tokens[index + 1] ?? "";
    if (!isMemoryType(value)) {
      return {
        type: null,
        text: "",
        error: `Unknown memory type "${value}". Use one of: ${MEMORY_TYPES.join(", ")}.`,
      };
    }

    type = value;
    index += inline === undefined ? 2 : 1;
  }

  return { type, text: tokens.slice(index).join(" ") };
}

function firstSentence(text: string): string {
  const sentence = /^(.+?)(?:[.!?](?:\s|$)|\n|$)/.exec(text.trim());
  return (sentence ? sentence[1]! : text).trim();
}

export function truncate(text: string, limit: number): string {
  if (text.length <= limit) {
    return text;
  }

  const cut = text.slice(0, limit - 3);
  const boundary = cut.lastIndexOf(" ");
  return `${(boundary > limit / 2 ? cut.slice(0, boundary) : cut).trimEnd()}...`;
}

export function draftFromText(text: string, type: MemoryType, sessionId: string | null): MemoryDraft {
  const sentence = firstSentence(text);

  return {
    title: truncate(sentence, 60),
    description: truncate(sentence, 160),
    body: text.trim(),
    type,
    hook: truncate(sentence, 100),
    sessionId,
  };
}
