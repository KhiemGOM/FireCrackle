"""Batch RGB binding to the one canonical Rust GUI mask, with local textures."""
import ctypes,hashlib,os,subprocess,sys
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[3]
_lib=None

def world_pixels(packed):
    cls=packed>>8;piece=packed&255
    # Unknown item/effect interiors and inverted crosshair are still GUI.
    known_gui=(cls==1)|(cls==2)|np.isin(piece,[4,5,11])
    return (~known_gui).astype(np.uint8)

def mask(rgb,*,vanilla_confirmed=False):
    if not vanilla_confirmed:raise ValueError('Confirm vanilla1.16.5 GUI before masking')
    global _lib
    if _lib is None:
        files=[Path(__file__).with_name('gui_mask_bridge.rs'),ROOT/'fire-detection/core/src/gui_mask.rs']
        digest=hashlib.sha256(b''.join(p.read_bytes() for p in files)).hexdigest()[:20]
        cache=ROOT/'.board/shared-veil'/('gui-'+digest);cache.mkdir(parents=True,exist_ok=True)
        ext='.dll' if sys.platform=='win32' else '.so';binary=cache/('gui'+ext)
        if not binary.exists():
            temp=cache/(f'gui-{os.getpid()}'+ext)
            subprocess.run(['rustc','--edition','2021','--crate-type','cdylib','-C','opt-level=3',str(files[0]),'-o',str(temp)],check=True)
            try:os.replace(temp,binary)
            except PermissionError:
                # A concurrent worker may already have published/loaded this
                # identical source-hashed DLL, which Windows cannot replace.
                if not binary.exists():raise
                temp.unlink(missing_ok=True)
        _lib=ctypes.CDLL(str(binary));ptr=ctypes.POINTER(ctypes.c_uint8);size=ctypes.c_size_t
        _lib.research_gui_mask.argtypes=[ptr,size,size,size,ctypes.c_char_p,ptr,ctypes.POINTER(ctypes.c_double)];_lib.research_gui_mask.restype=ctypes.c_int
    a=np.ascontiguousarray(rgb,dtype=np.uint8)
    if a.ndim!=3 or a.shape[2]!=3:raise ValueError('Expected RGB24')
    h,w=a.shape[:2];planes=np.zeros((2,h,w),np.uint8);meta=(ctypes.c_double*3)();ptr=ctypes.POINTER(ctypes.c_uint8)
    code=_lib.research_gui_mask(a.ctypes.data_as(ptr),a.size,w,h,str(ROOT/'fire-detection/data/assets/gui').encode(),planes.ctypes.data_as(ptr),meta)
    if code:raise RuntimeError(f'Canonical GUI mask failed: {code}')
    cls=planes[0];packed=(cls.astype(np.uint16)<<8)|planes[1]
    world=world_pixels(packed)
    return world,packed,{'reliable':bool(meta[0]),'scale':meta[1],'hits':int(meta[2]),'opaque_pixels':int((cls==1).sum()),'translucent_gui_pixels':int((cls==2).sum()),'unknown_gui_pixels':int((cls==3).sum())}
