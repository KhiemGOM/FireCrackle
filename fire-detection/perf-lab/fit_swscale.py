"""Derive, empirically and for this exact FFmpeg binary, the yuv420p -> rgb24 mapping that
swscale applies to a BT.709 limited-range stream, so the lab's in-worker conversion can be
bit-identical to what the app receives from `-pix_fmt rgb24`.

A synthetic 4096x4096 yuv420p frame enumerates every (Y, U, V) triple once (each 2x2
chroma block carries four luma values; 64 blocks per (U, V)). FFmpeg converts it with the
stream tagged bt709/tv, and the result is checked for the separable structure
R = fR[Y, V], G = fG[Y, U, V], B = fB[Y, U] that swscale's table code implies. The tables
are then verified on real decoded frames and written as `swscale_tables.json`.

  python fit_swscale.py FFMPEG VIDEO
"""
import json, subprocess, sys
from pathlib import Path
import numpy as np

ffmpeg, video = sys.argv[1], sys.argv[2]
out = Path(__file__).resolve().parent / 'swscale_tables.json'
W = H = 4096
# block index b = ((uv index) * 64 + k); Y for the 4 pixels of block k: 4k..4k+3
blocks = np.arange((W // 2) * (H // 2)).reshape(H // 2, W // 2)
uv = blocks // 64
k = blocks % 64
U = (uv // 256).astype(np.uint8)
V = (uv % 256).astype(np.uint8)
Y = np.zeros((H, W), np.uint8)
Y[0::2, 0::2] = 4 * k
Y[0::2, 1::2] = 4 * k + 1
Y[1::2, 0::2] = 4 * k + 2
Y[1::2, 1::2] = 4 * k + 3
raw = np.concatenate([Y.ravel(), U.ravel(), V.ravel()]).tobytes()
cmd = [ffmpeg, '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'yuv420p', '-s', f'{W}x{H}',
       '-colorspace', 'bt709', '-color_range', 'tv', '-color_primaries', 'bt709', '-color_trc', 'bt709',
       '-i', '-', '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-']
rgb = np.frombuffer(subprocess.run(cmd, input=raw, stdout=subprocess.PIPE, check=True).stdout, np.uint8).reshape(H, W, 3)
# Gather per (Y, U, V)
Yf = Y.ravel().astype(np.int64)
Uf = np.repeat(np.repeat(U, 2, 0), 2, 1).ravel().astype(np.int64)
Vf = np.repeat(np.repeat(V, 2, 0), 2, 1).ravel().astype(np.int64)
table = np.zeros((256, 256, 256, 3), np.uint8)
table[Yf, Uf, Vf] = rgb.reshape(-1, 3)
# Separability checks
r_dep_u = (table[:, :, :, 0] != table[:, :1, :, 0]).any()
b_dep_v = (table[:, :, :, 2] != table[:, :, :1, 2]).any()
print('R depends on U:', r_dep_u, ' B depends on V:', b_dep_v)
fR = table[:, 0, :, 0]      # [Y, V]
fB = table[:, :, 0, 2]      # [Y, U]
fG = table[:, :, :, 1]      # [Y, U, V]
tables = {}
# Direct full LUTs for exact reproduction regardless of model: R[Y,V], B[Y,U] (64 KB each)
tables['R_YV'] = fR.tolist()
tables['B_YU'] = fB.tolist()
np.save(out.with_name('swscale_G.npy'), fG)
out.write_text(json.dumps(tables))
# Verify on a real frame: ffmpeg rgb24 vs our model applied to ffmpeg yuv420p
def dec(pix):
    c = [ffmpeg, '-v', 'error', '-ss', '5490', '-i', video, '-frames:v', '2', '-pix_fmt', pix, '-f', 'rawvideo', '-']
    return np.frombuffer(subprocess.run(c, stdout=subprocess.PIPE, check=True).stdout, np.uint8)
probe = subprocess.run([ffmpeg.replace('ffmpeg', 'ffprobe'), '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', video], stdout=subprocess.PIPE, text=True).stdout.strip().split(',')
w, h = int(probe[0]), int(probe[1])
ref = dec('rgb24').reshape(2, h, w, 3)
yuv = dec('yuv420p').reshape(2, -1)
for fi in range(2):
    y = yuv[fi, :w * h].reshape(h, w).astype(int)
    u = yuv[fi, w * h:w * h + (w // 2) * (h // 2)].reshape(h // 2, w // 2)
    v = yuv[fi, w * h + (w // 2) * (h // 2):].reshape(h // 2, w // 2)
    uu = np.repeat(np.repeat(u, 2, 0), 2, 1).astype(int)
    vv = np.repeat(np.repeat(v, 2, 0), 2, 1).astype(int)
    pred = np.stack([fR[y, vv], fG[y, uu, vv], fB[y, uu]], -1)
    diff = (pred != ref[fi])
    print(f'real frame {fi}: mismatching channel values {int(diff.sum())} of {diff.size}; max abs diff {int(np.abs(pred.astype(int) - ref[fi].astype(int)).max())}')
