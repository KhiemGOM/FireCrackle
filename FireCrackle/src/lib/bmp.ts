// A lossless picture the webview shows directly: uncompressed 24-bit BMP, written in one pass.
// Used for corrected full-resolution frames, where a canvas PNG encode would take seconds.

export function bmpFromRgba(rgba: Uint8ClampedArray, width: number, height: number): Uint8Array<ArrayBuffer> {
  if (!(width > 0) || !(height > 0) || rgba.length !== width * height * 4) throw Error("Invalid picture size");
  const stride = (width * 3 + 3) & ~3, size = 54 + stride * height;
  const out = new Uint8Array(size), view = new DataView(out.buffer);
  out[0] = 0x42; out[1] = 0x4d;
  view.setUint32(2, size, true); view.setUint32(10, 54, true);
  view.setUint32(14, 40, true); view.setInt32(18, width, true);
  view.setInt32(22, -height, true); // negative: rows stored top first
  view.setUint16(26, 1, true); view.setUint16(28, 24, true);
  view.setUint32(34, stride * height, true);
  for (let y = 0; y < height; y++) {
    let o = 54 + y * stride, i = y * width * 4;
    for (let x = 0; x < width; x++, i += 4, o += 3) { out[o] = rgba[i + 2]; out[o + 1] = rgba[i + 1]; out[o + 2] = rgba[i]; }
  }
  return out;
}
