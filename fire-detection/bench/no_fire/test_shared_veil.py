import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import unittest
import numpy as np
from veil_native import apply, ROOT


class SharedVeilTest(unittest.TestCase):
    def test_gui_tooltip_neutral_and_alpha_preserved(self):
        rgb=np.full((60,100,4),20,np.uint8);rgb[:,:,3]=np.arange(100,dtype=np.uint8)[None,:]
        rgb[:,:5,:3]=[16,0,16];rgb[:,-5:,:3]=[16,0,16]
        result,detected,_=apply(rgb)
        self.assertTrue(detected);np.testing.assert_array_equal(result[:,:,3],rgb[:,:,3])
        for value in (0,139,255):
            _,found,_=apply(np.full((60,100,3),value,np.uint8));self.assertFalse(found)

    def test_native_and_browser_wasm_are_byte_identical(self):
        wasm=ROOT/'FireCrackle/src/lib/veil.wasm';node=shutil.which('node')
        if not wasm.exists() or not node:self.skipTest('Build frontend WASM and install Node for cross-binding parity')
        rgb=np.random.default_rng(447).integers(0,256,(48,64,3),dtype=np.uint8)
        native,_,_=apply(rgb,mode='on')
        script='''const fs=require('fs'),crypto=require('crypto');
        (async()=>{const {instance}=await WebAssembly.instantiate(fs.readFileSync(process.argv[1]));
        const e=instance.exports,b=fs.readFileSync(0),p=e.veil_alloc(b.length);
        new Uint8Array(e.memory.buffer,p,b.length).set(b);
        if(e.veil_inverse(p,b.length,64,48,3)!==0)throw Error('inverse failed');
        console.log(crypto.createHash('sha256').update(new Uint8Array(e.memory.buffer,p,b.length)).digest('hex'));
        e.veil_free(p,b.length);})().catch(e=>{console.error(e);process.exit(1)});'''
        digest=subprocess.check_output([node,'-e',script,str(wasm)],input=rgb.tobytes()).decode().strip()
        self.assertEqual(digest,hashlib.sha256(native.tobytes()).hexdigest())


if __name__=='__main__':unittest.main()
