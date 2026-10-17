import ctypes
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import unittest

import numpy as np
from portal_undo import apply_portal,translucency_guard,decide_no_fire
from veil_native import library,ROOT


class PortalBindingTest(unittest.TestCase):
    def fixture(self):
        tex=np.array([[[60+(x*31+y*47+p*67+x*y*13)%100,10+((x*31+y*47+p*67+x*y*13)%100)//3,170+((x*31+y*47+p*67+x*y*13)%100)//2,170+((x*31+y*47+p*67+x*y*13)%100)//2] for x in range(4)] for p in range(4) for y in range(4)],np.uint8)
        original=np.full((64,96,3),[70,50,35],np.uint8)
        layer=np.repeat(np.repeat(tex[8:12],16,0),24,1).astype(float)
        a=.75*layer[:,:,3:]/255
        image=np.round(original*(1-a)+layer[:,:,:3]*a).astype(np.uint8)
        return original,image,tex

    def test_binding_fits_and_recovers(self):
        original,image,tex=self.fixture();fixed,info,valid=apply_portal(image,tex)
        self.assertTrue(info['applied']);self.assertEqual(info['phase'],2)
        self.assertLess(abs(info['opacity']-.75),.04)
        self.assertLess(np.abs(fixed.astype(float)-original).mean(),3)
        self.assertTrue(valid.all())

    def test_external_translucency_always_abstains_except_masked_gui(self):
        rgb=np.zeros((64,96,3),np.uint8);known=np.zeros((64,96),np.uint8);known[30,30]=1
        self.assertTrue(translucency_guard(rgb,known_translucent=known)['abstain'])
        world=np.ones((64,96),np.uint8);world[30,30]=0
        self.assertFalse(translucency_guard(rgb,world,known)['abstain'])

    def test_no_fire_gate_never_clears_suspected_translucency(self):
        rgb=np.full((64,96,3),[100,20,180],np.uint8)
        self.assertEqual(decide_no_fire(rgb,True)['decision'],'review_translucency')
        rgb.fill(0)
        self.assertTrue(decide_no_fire(rgb,True)['clear'])
        self.assertEqual(decide_no_fire(rgb,False)['decision'],'review_fire_evidence')

    def test_native_wasm_portal_inverse_parity(self):
        node=shutil.which('node');wasm=ROOT/'FireCrackle/src/lib/veil.wasm'
        if not node or not wasm.exists():self.skipTest('Build sharedWASM and provideNode')
        _,image,tex=self.fixture();apply_portal(image,tex)
        result=image.copy();valid=np.zeros(image.shape[:2],np.uint8);ptr=ctypes.POINTER(ctypes.c_uint8)
        get=lambda a:a.ctypes.data_as(ptr)
        status=library().portal_inverse(get(result),result.size,96,64,get(tex),tex.size,4,2,.75,None,get(valid));self.assertEqual(status,0)
        payload={'rgb':image.tobytes().hex(),'tex':tex.tobytes().hex()}
        script="""const fs=require('fs'),crypto=require('crypto');(async()=>{
        const{instance}=await WebAssembly.instantiate(fs.readFileSync(process.argv[1]));const e=instance.exports;
        const data=JSON.parse(fs.readFileSync(0,'utf8')),rgb=Buffer.from(data.rgb,'hex'),tex=Buffer.from(data.tex,'hex');
        const p=e.veil_alloc(rgb.length),t=e.veil_alloc(tex.length),v=e.veil_alloc(96*64);
        new Uint8Array(e.memory.buffer,p,rgb.length).set(rgb);new Uint8Array(e.memory.buffer,t,tex.length).set(tex);
        if(e.portal_inverse(p,rgb.length,96,64,t,tex.length,4,2,.75,0,v)!==0)throw Error('portal inverse failed');
        const hash=crypto.createHash('sha256');hash.update(new Uint8Array(e.memory.buffer,p,rgb.length));hash.update(new Uint8Array(e.memory.buffer,v,96*64));console.log(hash.digest('hex'));
        e.veil_free(p,rgb.length);e.veil_free(t,tex.length);e.veil_free(v,96*64);
        })().catch(e=>{console.error(e);process.exit(1)});"""
        digest=subprocess.check_output([node,'-e',script,str(wasm)],input=json.dumps(payload).encode()).decode().strip()
        self.assertEqual(digest,hashlib.sha256(result.tobytes()+valid.tobytes()).hexdigest())


if __name__=='__main__':unittest.main()
