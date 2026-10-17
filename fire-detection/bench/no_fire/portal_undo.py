"""Thin portal binding. Fit/inverse live only in the shared Rust veil::portal module."""
import ctypes
import io
import math
from pathlib import Path
import zipfile
import numpy as np
from PIL import Image
from veil_native import library


def translucency_guard(rgb,world_mask=None,known_translucent=None):
    frame=np.ascontiguousarray(rgb,dtype=np.uint8)
    if frame.ndim!=3 or frame.shape[2]!=3:raise ValueError('Expected RGB24')
    h,w,_=frame.shape;ptr=ctypes.POINTER(ctypes.c_uint8);size=ctypes.c_size_t;dbl=ctypes.c_double
    convert=lambda a:None if a is None else np.ascontiguousarray(a,dtype=np.uint8)
    mask=convert(world_mask);known=convert(known_translucent)
    if any(a is not None and a.shape!=(h,w) for a in [mask,known]):raise ValueError('Mask shape differs')
    get=lambda a:None if a is None else a.ctypes.data_as(ptr)
    lib=library();lib.portal_guard.argtypes=[ptr,size,size,size,ptr,ptr,ctypes.POINTER(dbl)];lib.portal_guard.restype=ctypes.c_int
    values=(dbl*4)()
    if lib.portal_guard(get(frame),frame.size,w,h,get(mask),get(known),values)<0:raise ValueError('Invalid guard input')
    return {'abstain':bool(values[0]),'flags':int(values[1]),'largest_purple_candidate':int(values[2]),'known_translucent_pixels':int(values[3]),'coverage':'Known supplied translucency + suspected purple portal/effects; no hit does not prove opacity. Water/glass/ice are not yet inferred automatically.'}


def decide_no_fire(rgb,candidate_clear,world_mask=None,known_translucent=None):
    """Mandatory guard for the research no-fire path; correction never overrides abstention."""
    guard=translucency_guard(rgb,world_mask,known_translucent)
    decision='review_translucency' if guard['abstain'] else 'clear' if candidate_clear else 'review_fire_evidence'
    return {'decision':decision,'clear':decision=='clear','guard':guard,
            'status':'experimental_risky','requires_manual_review':True,'can_auto_confirm':False,
            'clear_means':'candidate_no_fire_only','assumptions':'EXPERIMENTAL-ASSUMPTIONS.md'}


def load_texture(jar):
    with zipfile.ZipFile(jar) as z:
        image=Image.open(io.BytesIO(z.read('assets/minecraft/textures/block/nether_portal.png'))).convert('RGBA')
    if image.height%image.width:raise ValueError('Expected square portal animation frames')
    return np.ascontiguousarray(image,dtype=np.uint8)


def apply_portal(rgb,atlas,world_mask=None):
    frame=np.ascontiguousarray(rgb,dtype=np.uint8)
    if frame.ndim!=3 or frame.shape[2]!=3:raise ValueError('Expected RGB24')
    h,w,_=frame.shape;tex=np.ascontiguousarray(atlas,dtype=np.uint8)
    if tex.ndim!=3 or tex.shape[2]!=4 or tex.shape[0]%tex.shape[1]:raise ValueError('Expected RGBA animation atlas')
    mask=None if world_mask is None else np.ascontiguousarray(world_mask,dtype=np.uint8)
    if mask is not None and mask.shape!=(h,w):raise ValueError('World mask shape differs')
    lib=library();ptr=ctypes.POINTER(ctypes.c_uint8);size=ctypes.c_size_t;dbl=ctypes.c_double
    lib.portal_fit.argtypes=[ptr,size,size,size,ptr,size,size,ptr,ctypes.POINTER(dbl)];lib.portal_fit.restype=ctypes.c_int
    lib.portal_inverse.argtypes=[ptr,size,size,size,ptr,size,size,size,dbl,ptr,ptr];lib.portal_inverse.restype=ctypes.c_int
    get=lambda a:None if a is None else a.ctypes.data_as(ptr)
    values=(dbl*8)();args=[get(frame),frame.size,w,h,get(tex),tex.size,tex.shape[1]]
    if lib.portal_fit(*args,get(mask),values)<0:raise ValueError('Portal fitting failed')
    keys=['detected','phase','opacity','residual','baseline','improvement','runner_up','purple_share']
    info={k:(float(v) if math.isfinite(v) else None) for k,v in zip(keys,values)}
    info['detected']=bool(values[0]);info['phase']=int(values[1]);info['applied']=False
    valid=np.zeros((h,w),np.uint8)
    if not info['detected']:return rgb,info,valid
    output=frame.copy()
    if lib.portal_inverse(get(output),output.size,w,h,get(tex),tex.size,tex.shape[1],info['phase'],info['opacity'],get(mask),get(valid))<0:raise ValueError('Portal inverse failed')
    info['applied']=True;info['valid_fraction']=float(valid.mean())
    return output,info,valid
