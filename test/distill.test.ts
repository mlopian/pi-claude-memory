import { describe, expect, it } from "vitest";
import { extractJson } from "../src/distill.ts";

const VALID = {
  title: "Branch naming",
  description: "Branches must not contain a slash",
  body: "Use dashes.",
  hook: "previews break",
};

describe("extractJson", () => {
  it("reads a bare JSON object", () => {
    expect(extractJson(JSON.stringify(VALID))).toEqual(VALID);
  });

  it("reads a fenced JSON block", () => {
    expect(extractJson("```json\n" + JSON.stringify(VALID) + "\n```")).toEqual(VALID);
  });

  it("reads an object wrapped in prose", () => {
    expect(extractJson(`Here it is:\n${JSON.stringify(VALID)}\nHope that helps.`)).toEqual(VALID);
  });

  it("trims whitespace in the fields", () => {
    expect(extractJson(JSON.stringify({ ...VALID, title: "  Branch naming  " })).title).toBe("Branch naming");
  });

  it("reports the raw response when there is no object", () => {
    expect(() => extractJson("I cannot do that")).toThrow(/Response: I cannot do that/);
  });

  it("reports an empty response distinctly", () => {
    expect(() => extractJson("")).toThrow(/Response: <empty>/);
  });

  it("names the missing field", () => {
    const partial = { ...VALID, hook: "" };

    expect(() => extractJson(JSON.stringify(partial))).toThrow(/missing "hook"/);
  });
});
