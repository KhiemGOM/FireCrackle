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

  it("auto decides from the GUI detector alone: a veiled-looking frame with no detected screen stays as it is", async () => {
    // a dark colourless cave looks exactly like the veil; only a detected open screen means the veil is there
    const fake = io(veiledPixels());
    const orig = original();
    const r = await processFrame(bytes, orig, "auto", DEFAULT_VEIL_OPTIONS, fake);
    expect(r.applied).toBe(false);
    expect(r.blob).toBe(orig);
    expect(fake.encode).not.toHaveBeenCalled();
  });

  it("auto undoes the veil when a screen was detected, and encodes the unveiled pixels", async () => {
    const pixels = veiledPixels();
    const fake = io(pixels);
    const r = await processFrame(bytes, original(), "auto", DEFAULT_VEIL_OPTIONS, fake, undefined, undefined, { width: W, height: H });
    expect(r.applied).toBe(true);
    expect(r.blob.type).toBe("image/png");
    expect(fake.encoded[0]).toEqual(unveilRgba(pixels, W, H));
  });

  it("a screen found on the native frame (twice the size, same shape) unveils the display picture and its screen stays", async () => {
    const pixels = veiledPixels();
    const fake = io(pixels);
    // native 80x40 coverage: the left half is the open screen (world 0), the right half world (1)
    const world = new Uint8Array(W * 2 * H * 2).map((_, i) => (i % (W * 2) < W ? 0 : 1));
    const r = await processFrame(bytes, original(), "auto", DEFAULT_VEIL_OPTIONS, fake, undefined, undefined, { width: W * 2, height: H * 2 }, { width: W * 2, height: H * 2, world });
    expect(r.applied).toBe(true);
    const out = fake.encoded[0], unveiled = unveilRgba(pixels, W, H);
    expect(Array.from(out.subarray(0, 4))).toEqual(Array.from(pixels.subarray(0, 4)));
    const right = ((H - 1) * W + W - 1) * 4;
    expect(Array.from(out.subarray(right, right + 4))).toEqual(Array.from(unveiled.subarray(right, right + 4)));
  });

  it("auto leaves a normal frame as the original blob (no re-encoding)", async () => {
    const fake = io(normalPixels());
    const orig = original();
    const r = await processFrame(bytes, orig, "auto", DEFAULT_VEIL_OPTIONS, fake);
    expect(r.applied).toBe(false);
    expect(r.blob).toBe(orig);
    expect(fake.encode).not.toHaveBeenCalled();
  });

  it("uses a detected screen to unveil a frame the colours alone would not call veiled", async () => {
    const pixels = normalPixels();
    const fake = io(pixels);
    const result = await processFrame(bytes, original(), "auto", DEFAULT_VEIL_OPTIONS, fake, undefined, undefined, { width: W, height: H });
    expect(result.applied).toBe(true);
    expect(fake.encoded[0]).toEqual(unveilRgba(pixels, W, H));
  });

  it("ignores screen evidence of another shape and keeps Off authoritative", async () => {
    for (const [mode, width] of [["auto", W * 3], ["off", W]] as const) {
      const fake = io(normalPixels());
      const orig = original();
      const result = await processFrame(bytes, orig, mode, DEFAULT_VEIL_OPTIONS, fake, undefined, undefined, { width, height: H });
      expect(result.applied).toBe(false);
      expect(result.blob).toBe(orig);
      expect(fake.encode).not.toHaveBeenCalled();
    }
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

  it("the colour thresholds no longer change what Auto does: the detected screen decides", async () => {
    const odd = { ...DEFAULT_VEIL_OPTIONS, minShare: 0 };
    const none = await processFrame(bytes, original(), "auto", odd, io(veiledPixels()));
    expect([none.applied, none.error]).toEqual([false, undefined]);
    const found = await processFrame(bytes, original(), "auto", odd, io(veiledPixels()), undefined, undefined, { width: W, height: H });
    expect([found.applied, found.error]).toEqual([true, undefined]);
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

describe("processFrame with an enhancement stage", () => {
  const brighten = (image: { data: Uint8ClampedArray }) => ({ data: image.data.map((v, i) => (i % 4 === 3 ? v : Math.min(255, v + 10))) as unknown as Uint8ClampedArray, applied: true });
  const portalNone = async (image: { data: Uint8ClampedArray }) => ({ data: image.data, applied: false, valid: new Uint8Array(W * H), phase: 0, opacity: 0 });

  it("with veil off and no portal, decodes, enhances and encodes exactly once", async () => {
    const pixels = normalPixels(), fake = io(pixels), stage = vi.fn(brighten);
    const r = await processFrame(bytes, original(), "off", DEFAULT_VEIL_OPTIONS, fake, undefined, stage);
    expect(stage).toHaveBeenCalledOnce();
    expect(fake.encode).toHaveBeenCalledOnce();
    expect(fake.encoded[0][0]).toBe(210);
    expect(fake.encoded[0][3]).toBe(255);
    expect(r).toMatchObject({ enhanced: true, applied: false });
  });

  it("gives the original blob, with no encoding, when the stage changes nothing", async () => {
    const fake = io(normalPixels()), orig = original();
    const r = await processFrame(bytes, orig, "off", DEFAULT_VEIL_OPTIONS, fake, undefined, image => ({ data: image.data, applied: false }));
    expect(r.blob).toBe(orig);
    expect(r.enhanced).toBe(false);
    expect(fake.encode).not.toHaveBeenCalled();
  });

  it("runs after the veil is undone and receives the unveiled pixels", async () => {
    const pixels = veiledPixels(), fake = io(pixels), expected = unveilRgba(pixels, W, H);
    const stage = vi.fn((image: { data: Uint8ClampedArray }) => {
      expect(image.data).toEqual(expected);
      return brighten(image);
    });
    const r = await processFrame(bytes, original(), "on", DEFAULT_VEIL_OPTIONS, fake, undefined, stage);
    expect(fake.encode).toHaveBeenCalledOnce();
    expect(r).toMatchObject({ applied: true, enhanced: true });
    expect(fake.encoded[0][0]).toBe(Math.min(255, expected[0] + 10));
  });

  it("runs after the portal stage and receives its output", async () => {
    const pixels = normalPixels(), fake = io(pixels);
    const portal = vi.fn(async (image: { data: Uint8ClampedArray }) => ({ data: image.data.map((v, i) => (i % 4 === 3 ? v : 100)) as unknown as Uint8ClampedArray, applied: true, valid: new Uint8Array(W * H), phase: 1, opacity: 0.5 }));
    const stage = vi.fn((image: { data: Uint8ClampedArray }) => { expect(image.data[0]).toBe(100); return brighten(image); });
    const r = await processFrame(bytes, original(), "off", DEFAULT_VEIL_OPTIONS, fake, portal, stage);
    expect(fake.encode).toHaveBeenCalledOnce();
    expect(r).toMatchObject({ portalApplied: true, enhanced: true });
    expect(fake.encoded[0][0]).toBe(110);
  });

  it("still encodes once and reports enhanced when portal finds nothing but the stage applies", async () => {
    const fake = io(normalPixels());
    const r = await processFrame(bytes, original(), "off", DEFAULT_VEIL_OPTIONS, fake, portalNone, brighten);
    expect(fake.encode).toHaveBeenCalledOnce();
    expect(r).toMatchObject({ portalApplied: false, enhanced: true });
  });

  it("keeps a successful unveil and reports the error when the stage throws", async () => {
    const pixels = veiledPixels(), fake = io(pixels), expected = unveilRgba(pixels, W, H);
    const r = await processFrame(bytes, original(), "on", DEFAULT_VEIL_OPTIONS, fake, undefined, () => { throw new Error("boom"); });
    expect(r).toMatchObject({ applied: true, enhanced: false });
    expect(r.error).toContain("boom");
    expect(fake.encoded[0]).toEqual(expected);
  });

  it("returns the original blob with the error when the stage throws and nothing else applied", async () => {
    const fake = io(normalPixels()), orig = original();
    const r = await processFrame(bytes, orig, "off", DEFAULT_VEIL_OPTIONS, fake, undefined, () => { throw new Error("boom"); });
    expect(r.blob).toBe(orig);
    expect(r.error).toContain("boom");
    expect(fake.encode).not.toHaveBeenCalled();
  });

  it("does not call the stage when the picture cannot be read", async () => {
    const fake = io(veiledPixels(), { decode: vi.fn(async () => { throw new Error("bad jpeg"); }) }), stage = vi.fn(brighten);
    const r = await processFrame(bytes, original(), "auto", DEFAULT_VEIL_OPTIONS, fake, undefined, stage, { width: W, height: H });
    expect(r.error).toBeTruthy();
    expect(stage).not.toHaveBeenCalled();
  });

  it("never calls the stage when none is given, and still returns the original untouched for veil off", async () => {
    const fake = io(normalPixels()), orig = original();
    const r = await processFrame(bytes, orig, "off", DEFAULT_VEIL_OPTIONS, fake);
    expect(r.blob).toBe(orig);
    expect(fake.decode).not.toHaveBeenCalled();
    expect(r.enhanced).toBeFalsy();
  });
});

it.each(['auto','on'] as const)('preserves supplied GUI coverage only for Auto (%s)',async mode=>{
 const pixels=normalPixels(),saved=new Uint8ClampedArray(pixels),fake=io(pixels),world=new Uint8Array(W*H).fill(1);world[0]=0;
 const expected=unveilRgba(pixels,W,H);if(mode==='auto')expected.set(pixels.subarray(0,4),0);
 const portal=vi.fn(async(image:{data:Uint8ClampedArray})=>{expect(image.data).toEqual(expected);return {data:image.data,applied:false,valid:new Uint8Array(W*H),phase:0,opacity:0};});
 await processFrame(bytes,original(),mode,DEFAULT_VEIL_OPTIONS,fake,portal,undefined,{width:W,height:H},{width:W,height:H,world});
 expect(fake.encoded[0]).toEqual(expected);expect(portal).toHaveBeenCalledOnce();expect(pixels).toEqual(saved);
});
it.each([{width:W*3,height:H,world:new Uint8Array(W*3*H)},{width:W,height:H,world:new Uint8Array(1)}])('ignores coverage of another shape or with a wrong pixel count',async coverage=>{
 const pixels=veiledPixels(),fake=io(pixels);await processFrame(bytes,original(),'auto',DEFAULT_VEIL_OPTIONS,fake,undefined,undefined,{width:W,height:H},coverage);expect(fake.encoded[0]).toEqual(unveilRgba(pixels,W,H));
});
