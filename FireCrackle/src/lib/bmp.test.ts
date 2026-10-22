import { expect, it } from "vitest";
import { bmpFromRgba } from "./bmp";

const u32 = (b: Uint8Array, at: number) => new DataView(b.buffer).getUint32(at, true);
const i32 = (b: Uint8Array, at: number) => new DataView(b.buffer).getInt32(at, true);
const u16 = (b: Uint8Array, at: number) => new DataView(b.buffer).getUint16(at, true);

it("writes an uncompressed 24-bit picture with a valid header", () => {
  const bmp = bmpFromRgba(new Uint8ClampedArray(4 * 4 * 2), 4, 2);
  expect(String.fromCharCode(bmp[0], bmp[1])).toBe("BM");
  expect(u32(bmp, 2)).toBe(bmp.length);
  expect(u32(bmp, 10)).toBe(54);
  expect([i32(bmp, 18), i32(bmp, 22)]).toEqual([4, -2]);
  expect([u16(bmp, 26), u16(bmp, 28), u32(bmp, 30)]).toEqual([1, 24, 0]);
  expect(bmp.length).toBe(54 + 4 * 3 * 2);
});

it("keeps every pixel value exactly, top row first, in BGR order", () => {
  const rgba = new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 255, 7, 8, 9, 255, 10, 11, 12, 255]);
  const bmp = bmpFromRgba(rgba, 2, 2);
  expect([...bmp.subarray(54, 60)]).toEqual([3, 2, 1, 6, 5, 4]);
  expect([...bmp.subarray(60 + 2, 68)]).toEqual([9, 8, 7, 12, 11, 10]);
});

it("pads each row to four bytes for odd widths", () => {
  const rgba = new Uint8ClampedArray(3 * 2 * 4).fill(200);
  const bmp = bmpFromRgba(rgba, 3, 2);
  expect(bmp.length).toBe(54 + 12 * 2);
  expect([...bmp.subarray(54 + 9, 54 + 12)]).toEqual([0, 0, 0]);
  expect(bmp[54 + 12]).toBe(200);
});

it("rejects pixels that do not match the size", () => {
  expect(() => bmpFromRgba(new Uint8ClampedArray(7), 2, 2)).toThrow();
  expect(() => bmpFromRgba(new Uint8ClampedArray(0), 0, 0)).toThrow();
});
