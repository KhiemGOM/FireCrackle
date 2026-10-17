// Compile the canonical Rust implementation; no JS/TS copy of its pixel rules.
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readFileSync,writeFileSync} from 'node:fs';
import {preparePortalAsset} from './portal-assets.mjs';
await preparePortalAsset();
const source=fileURLToPath(new URL('../../fire-detection/core/src/veil_abi.rs',import.meta.url));
const output=fileURLToPath(new URL('../src/lib/veil.wasm',import.meta.url));
const r=spawnSync('rustc',['--edition','2021','--crate-type','cdylib','--target','wasm32-unknown-unknown','-C','opt-level=3','-C','panic=abort','-C','strip=symbols',source,'-o',output],{stdio:'inherit'});
if(r.error)throw r.error;if(r.status!==0){console.error('Install the WASM target with: rustup target add wasm32-unknown-unknown');process.exit(r.status||1);}
const {instance}=await WebAssembly.instantiate(readFileSync(output));
const e=instance.exports;
writeFileSync(fileURLToPath(new URL('../src/lib/veil.generated.ts',import.meta.url)),`// Generated from Rust; edit core/src/veil.rs instead.\nexport const A_TOP = ${e.veil_constant(0)};\nexport const A_BOTTOM = ${e.veil_constant(1)};\nexport const COLOUR = ${e.veil_constant(2)};\nexport const DEFAULT_VEIL_OPTIONS = { minShare: ${e.veil_constant(3)}, margin: ${e.veil_constant(4)}, slack: ${e.veil_constant(5)} };\n`);
