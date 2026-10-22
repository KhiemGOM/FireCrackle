import { describe, expect, it } from "vitest";
import { CREDITS, creditNames, validateCredits, type CreditSection } from "./credits";

const find = (name: string) => CREDITS.flatMap((s) => s.entries).find((e) => e.name === name);

describe("the credits", () => {
  it("keeps research credits first and credits downloaded tools", () => {
    expect(CREDITS.map((s) => s.title)).toEqual(["The research behind Fire Cracking", "Community", "Tool development", "External tools · downloaded separately"]);
  });

  it("credits the research in the order it happened, with what each person did", () => {
    const research = CREDITS[0].entries;
    expect(research.map((e) => e.name)).toEqual(["Dijakonal", "Lagios", "Jasper", "Dart"]);
    expect(find("Dijakonal")?.note).toMatch(/tick/i);
    expect(find("Lagios")?.note).toMatch(/splice/i);
    expect(find("Jasper")?.note).toMatch(/jolt cracking/i);
    expect(find("Dart")?.note).toMatch(/hints throughout the process/i);
    expect(find("Dart")?.note).not.toMatch(/initially/i);
  });

  it("thanks the Minecraft Forensics server", () => {
    expect(CREDITS[1].entries.map((e) => e.name)).toEqual(["Minecraft Forensics"]);
    const note = find("Minecraft Forensics")?.note ?? "";
    expect(note).toMatch(/everyone/i);
    expect(note).toMatch(/not named above/i);
    expect(note).toMatch(/ideas/i);
    expect(note).toMatch(/own research/i);
    expect(note).toMatch(/beta test/i);
    expect(note).toMatch(/feedback on the tools/i);
  });

  it("credits KhiemGOM for building the tool", () => {
    expect(CREDITS[2].entries.map((e) => e.name)).toEqual(["KhiemGOM"]);
    expect(find("KhiemGOM")?.note).toMatch(/built/i);
  });

  it("lists every name exactly once", () => {
    const names = creditNames();
    expect(names).toEqual(["Dijakonal", "Lagios", "Jasper", "Dart", "Minecraft Forensics", "KhiemGOM", "Splosh", "yt-dlp contributors", "Deno contributors", "FFmpeg contributors and Gyan Doshi"]);
    expect(new Set(names).size).toBe(names.length);
  });

  it("passes its own validation", () => {
    expect(validateCredits(CREDITS)).toEqual([]);
  });
});

describe("validateCredits", () => {
  const good: CreditSection[] = [{ title: "A", entries: [{ name: "X", note: "did x" }] }];

  it("accepts well-formed credits", () => {
    expect(validateCredits(good)).toEqual([]);
  });
  it("rejects no sections at all", () => {
    expect(validateCredits([])).not.toEqual([]);
  });
  it("rejects an empty section", () => {
    expect(validateCredits([{ title: "A", entries: [] }])).not.toEqual([]);
  });
  it("rejects blank or whitespace-only titles, names and notes", () => {
    expect(validateCredits([{ title: " ", entries: [{ name: "X", note: "n" }] }])).not.toEqual([]);
    expect(validateCredits([{ title: "A", entries: [{ name: "", note: "n" }] }])).not.toEqual([]);
    expect(validateCredits([{ title: "A", entries: [{ name: "X", note: "  " }] }])).not.toEqual([]);
  });
  it("rejects the same person twice, whatever the capitalisation", () => {
    const dup: CreditSection[] = [
      { title: "A", entries: [{ name: "Dart", note: "n" }] },
      { title: "B", entries: [{ name: "dart", note: "n" }] },
    ];
    expect(validateCredits(dup)).not.toEqual([]);
  });
  it("rejects names with stray surrounding whitespace", () => {
    expect(validateCredits([{ title: "A", entries: [{ name: " X", note: "n" }] }])).not.toEqual([]);
  });
});
