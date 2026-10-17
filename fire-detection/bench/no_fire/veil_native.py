"""Thin NumPy/ctypes binding to core/src/veil.rs. No detection or inverse math here."""
import ctypes
import hashlib
import os
from pathlib import Path
import subprocess
import sys
import numpy as np

ROOT=Path(__file__).resolve().parents[3]
_library=None


def library():
    global _library
    if _library is not None:return _library
    src=ROOT/'fire-detection/core/src';digest=hashlib.sha256((src/'veil.rs').read_bytes()+(src/'veil_abi.rs').read_bytes()).hexdigest()[:20]
    cache=ROOT/'.board/shared-veil'/digest;cache.mkdir(parents=True,exist_ok=True)
    extension='.dll' if sys.platform=='win32' else '.dylib' if sys.platform=='darwin' else '.so'
    output=cache/f'veil{extension}'
    if not output.exists():
        temporary=cache/f'veil-{os.getpid()}{extension}'
        subprocess.run(['rustc','--edition','2021','--crate-type','cdylib','-C','opt-level=3',str(src/'veil_abi.rs'),'-o',str(temporary)],check=True)
        os.replace(temporary,output)
    lib=ctypes.CDLL(str(output));lib.veil_constant.argtypes=[ctypes.c_uint32];lib.veil_constant.restype=ctypes.c_double;ptr=ctypes.POINTER(ctypes.c_uint8);size=ctypes.c_size_t;dbl=ctypes.c_double
    lib.veil_detect.argtypes=[ptr,size,size,size,size,size,dbl,dbl,dbl];lib.veil_detect.restype=ctypes.c_int
    lib.veil_share.argtypes=[ptr,size,size,size,size,size];lib.veil_share.restype=dbl
    lib.veil_inverse.argtypes=[ptr,size,size,size,size];lib.veil_inverse.restype=ctypes.c_int
    _library=lib;return lib


def apply(rgb,mode='auto',y0=0):
    frame=np.ascontiguousarray(rgb,dtype=np.uint8)
    if frame.ndim!=3 or frame.shape[2] not in (3,4):raise ValueError('Expected RGB/RGBA image')
    h,w,c=frame.shape;lib=library();ptr=frame.ctypes.data_as(ctypes.POINTER(ctypes.c_uint8))
    result=lib.veil_detect(ptr,frame.size,w,h,c,y0,*(lib.veil_constant(i) for i in (3,4,5)))
    if result<0:raise ValueError('Invalid veil frame/options')
    share=lib.veil_share(ptr,frame.size,w,h,c,y0)
    if mode not in ('auto','off','on'):raise ValueError('Invalid veil mode')
    applied=mode=='on' or mode=='auto' and bool(result)
    if not applied:return rgb,False,share
    output=frame.copy();ptr=output.ctypes.data_as(ctypes.POINTER(ctypes.c_uint8))
    if lib.veil_inverse(ptr,output.size,w,h,c)<0:raise ValueError('Invalid inverse frame')
    return output,True,share
