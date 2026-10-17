import { vi as sharedVeilTest } from "vitest";
import { initVeil } from "./veil";
beforeAll(async()=>{
  const {readFile}=await sharedVeilTest.importActual<{readFile(path:URL):Promise<Uint8Array<ArrayBuffer>>}>("node:fs/promises");
  await initVeil(await readFile(new URL("./veil.wasm",import.meta.url)));
});
import { beforeAll, describe, expect, it, vi } from "vitest";
import { DEFAULT_VEIL_OPTIONS, unveilRgba, veilOptionsFromSettings } from "./veil";
import { processFrame, type FrameIo } from "./veilFrame";
import type { SettingInfo } from "./api";
import { DEFAULT_PREFERENCES, readPreferences, writePreferences } from "./preferences";

const W = 40;
const H = 20;

/** A veiled frame: 16a + p(1-a) of a mid-grey picture, so detection says veiled. */
function veiledPixels(): Uint8ClampedArray {
  const f = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    const a = 192 / 255 + ((208 / 255 - 192 / 255) * (y + 0.5)) / H;
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      f.fill(Math.round(16 * a + 120 * (1 - a)), i, i + 3);
      f[i + 3] = 255;
    }
  }
  return f;
}

const normalPixels = () => {
  const f = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < f.length; i += 4) f.fill(200, i, i + 3), (f[i + 3] = 255);
  return f;
};

function io(pixels: Uint8ClampedArray, over: Partial<FrameIo> = {}): FrameIo & { encoded: Uint8ClampedArray[] } {
  const encoded: Uint8ClampedArray[] = [];
  return {
    encoded,
    decode: vi.fn(async () => ({ data: pixels, width: W, height: H })),
    encode: vi.fn(async (data: Uint8ClampedArray) => {
      encoded.push(data);
      return new Blob([new Uint8Array(4)], { type: "image/png" });
    }),
    ...over,
  };
}

const bytes = new Uint8Array([1, 2, 3]).buffer;
const original = () => new Blob([bytes], { type: "image/jpeg" });

describe("processFrame", () => {
  it("runs portal correction after unveil, encodes once, and preserves a successful unveil on portal failure", async () => {
    const pixels=veiledPixels(),fake=io(pixels),expected=unveilRgba(pixels,W,H);
    const stage=vi.fn(async (image:{data:Uint8ClampedArray})=>{
      expect(image.data).toEqual(expected);
      throw Error("uncertain portal");
    });
    const r=await processFrame(bytes,original(),"on",DEFAULT_VEIL_OPTIONS,fake,stage);
    expect(stage).toHaveBeenCalledOnce();expect(fake.encode).toHaveBeenCalledOnce();
    expect(fake.encoded[0]).toEqual(expected);expect(r.applied).toBe(true);
    expect(r.portalApplied).toBe(false);expect(r.error).toContain("uncertain portal");
  });

  it("portal can process with veil off and returns the original blob when no fit is accepted", async () => {
    const fake=io(normalPixels()),orig=original();
    const r=await processFrame(bytes,orig,"off",DEFAULT_VEIL_OPTIONS,fake,async image=>({data:image.data,applied:false,valid:new Uint8Array(W*H),phase:0,opacity:0}));
    expect(fake.decode).toHaveBeenCalledOnce();expect(fake.encode).not.toHaveBeenCalled();expect(r.blob).toBe(orig);
  });
  it("off returns the original bytes untouched and never decodes", async () => {
    const fake = io(veiledPixels());
    const r = await processFrame(bytes, original(), "off", DEFAULT_VEIL_OPTIONS, fake);
    expect(r.applied).toBe(false);
    expect(r.blob.type).toBe("image/jpeg");
    expect(fake.decode).not.toHaveBeenCalled();
    expect(fake.encode).not.toHaveBeenCalled();
  });

  it("auto undoes a veiled frame and encodes the unveiled pixels", async () => {
    const pixels = veiledPixels();
    const fake = io(pixels);
    const r = await processFrame(bytes, original(), "auto", DEFAULT_VEIL_OPTIONS, fake);
    expect(r.applied).toBe(true);
    expect(r.blob.type).toBe("image/png");
    expect(fake.encoded[0]).toEqual(unveilRgba(pixels, W, H));
  });

  it("auto leaves a normal frame as the original blob (no re-encoding)", async () => {
    const fake = io(normalPixels());
    const orig = original();
    const r = await processFrame(bytes, orig, "auto", DEFAULT_VEIL_OPTIONS, fake);
    expect(r.applied).toBe(false);
    expect(r.blob).toBe(orig);
    expect(fake.encode).not.toHaveBeenCalled();
  });

  it("on undoes even a frame that does not look veiled", async () => {
    const fake = io(normalPixels());
    const r = await processFrame(bytes, original(), "on", DEFAULT_VEIL_OPTIONS, fake);
    expect(r.applied).toBe(true);
    expect(fake.encode).toHaveBeenCalledTimes(1);
  });

  it("a decode failure falls back to the original and says why", async () => {
    const fake = io(veiledPixels(), { decode: vi.fn(async () => { throw new Error("bad jpeg"); }) });
    const orig = original();
    const r = await processFrame(bytes, orig, "on", DEFAULT_VEIL_OPTIONS, fake);
    expect(r).toMatchObject({ applied: false, blob: orig });
    expect(r.error).toContain("bad jpeg");
  });

  it("an encode failure falls back to the original and says why", async () => {
    const fake = io(veiledPixels(), { encode: vi.fn(async () => { throw new Error("no canvas"); }) });
    const orig = original();
    const r = await processFrame(bytes, orig, "on", DEFAULT_VEIL_OPTIONS, fake);
    expect(r).toMatchObject({ applied: false, blob: orig });
    expect(r.error).toContain("no canvas");
  });

  it("invalid thresholds fall back to the original and say why, without encoding", async () => {
    const fake = io(veiledPixels());
    const r = await processFrame(bytes, original(), "auto", { ...DEFAULT_VEIL_OPTIONS, minShare: 0 }, fake);
    expect(r.applied).toBe(false);
    expect(r.error).toBeTruthy();
    expect(fake.encode).not.toHaveBeenCalled();
  });
});

describe("veilOptionsFromSettings", () => {
  const info = (key: string, value: number) => ({ key, label: key, value, default: value, min: 0, max: 1, integer: false, explanation: "" }) satisfies SettingInfo;
  it("reads the three thresholds", () => {
    expect(veilOptionsFromSettings([info("label.veil_min_share", 0.8), info("label.veil_margin", 0.3), info("label.veil_slack", 4)])).toEqual({ minShare: 0.8, margin: 0.3, slack: 4 });
  });
  it("uses the defaults while settings are not loaded", () => {
    expect(veilOptionsFromSettings([])).toEqual(DEFAULT_VEIL_OPTIONS);
  });
});

describe("veil mode preference", () => {
  it("defaults to off", () => {
    expect(DEFAULT_PREFERENCES.veilMode).toBe("off");
  });
  it("round-trips and merges with other preferences", () => {
    let raw: string | null = null;
    const storage = { getItem: () => raw, setItem: (_: string, v: string) => { raw = v; } };
    writePreferences({ veilMode: "auto" }, storage);
    writePreferences({ matchOpen: true }, storage);
    expect(readPreferences(storage)).toMatchObject({ veilMode: "auto", matchOpen: true });
  });
  it("ignores an unknown mode", () => {
    expect(readPreferences({ getItem: () => '{"veilMode":"sometimes"}' }).veilMode).toBe("off");
    expect(readPreferences({ getItem: () => '{"veilMode":3}' }).veilMode).toBe("off");
  });
});
