// Channel view: show one colour channel, or the brightness, as a grey picture.

export interface ChannelsParams { mode: number }
export const DEFAULT_CHANNELS: ChannelsParams = { mode: 0 };
export const CHANNEL_MODES: ReadonlyArray<{ value: number; label: string }> = [
  { value: 0, label: "All" },
  { value: 1, label: "Red" },
  { value: 2, label: "Green" },
  { value: 3, label: "Blue" },
  { value: 4, label: "Brightness" },
];

/** Showing all channels (or an unknown mode) changes nothing. */
export function isChannelsIdentity(p: ChannelsParams): boolean {
  return !(p.mode >= 1 && p.mode <= 4);
}

export function applyChannels(data: Uint8ClampedArray, p: ChannelsParams): Uint8ClampedArray {
  if (data.length % 4) throw new Error("Invalid pixel buffer: not whole RGBA pixels");
  if (isChannelsIdentity(p)) return data;
  const out = new Uint8ClampedArray(data.length);
  for (let i = 0; i < data.length; i += 4) {
    const v = p.mode === 4 ? Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) : data[i + p.mode - 1];
    out[i] = v;
    out[i + 1] = v;
    out[i + 2] = v;
    out[i + 3] = data[i + 3];
  }
  return out;
}
