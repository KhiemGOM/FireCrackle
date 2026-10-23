// Compile the 3D fire tool's ABI (fire-detection/core/src/reversal_abi.rs: camera, reversal, fire_model) to WASM, the
// same way build-veil.mjs compiles veil_abi.rs. No TS copy of any of that math.
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
export async function buildReversalWasm(){
  const source=fileURLToPath(new URL('../../fire-detection/core/src/reversal_abi.rs',import.meta.url));
  const output=fileURLToPath(new URL('../src/lib/reversal.wasm',import.meta.url));
  const r=spawnSync('rustc',['--edition','2021','--crate-type','cdylib','--target','wasm32-unknown-unknown','-C','opt-level=3','-C','panic=abort','-C','strip=symbols',source,'-o',output],{stdio:'inherit'});
  if(r.error)throw r.error;if(r.status!==0){console.error('Install the WASM target with: rustup target add wasm32-unknown-unknown');process.exit(r.status||1);}
}
