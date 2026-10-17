import { beforeAll, describe, expect, it, vi } from "vitest";

// Post-processing is for looking at a picture. The detector, the GUI mask, the matcher and the phase tools must keep
// working from the original frames, so nothing in the post-processing code may reach them.
const FORBIDDEN = [/\/api["']/, /\/mock["']/, /guiMask/i, /useGuiMask/, /@tauri-apps/, /backend/i, /\/matcher/, /\/phase/i, /detector/i];

type Fs = { readdirSync(path: URL): string[]; readFileSync(path: URL, encoding: "utf8"): string };
let fs: Fs;
beforeAll(async () => { fs = await vi.importActual<Fs>("node:fs"); });

const here = new URL("./", import.meta.url);
const src = new URL("../../", import.meta.url);
const sources = () => [
  ...fs.readdirSync(here).filter(f => f.endsWith(".ts") && !f.endsWith(".test.ts")).map(f => ({ name: `lib/post/${f}`, url: new URL(f, here) })),
  { name: "components/EnhancePanel.tsx", url: new URL("components/EnhancePanel.tsx", src) },
  { name: "hooks/usePostSettings.ts", url: new URL("hooks/usePostSettings.ts", src) },
];
const importsOf = (url: URL) => [...fs.readFileSync(url, "utf8").matchAll(/^\s*(?:import|export)[^;]*?from\s+["']([^"']+)["']/gm)].map(m => m[1]);

describe("post-processing stays a viewing aid", () => {
  it("covers the post-processing sources", () => {
    expect(sources().length).toBeGreaterThanOrEqual(7);
  });

  it("imports nothing from the detector, GUI mask, backend, matcher or phase code", () => {
    for (const file of sources()) for (const spec of importsOf(file.url)) for (const bad of FORBIDDEN) expect(`${file.name}: ${spec}"`).not.toMatch(bad);
  });
});
