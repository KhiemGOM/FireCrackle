// App libraries (src/lib/*.ts) in Node, for the evaluation scripts. TypeScript 7 (the native compiler) has no JavaScript
// API to transpile with, so this uses Node's own type stripping and follows each library's relative imports.
import fs from "node:fs";
import path from "node:path";
import {stripTypeScriptTypes} from "node:module";
import {pathToFileURL} from "node:url";
import {createHash} from "node:crypto";

const lib=path.resolve(import.meta.dirname,"../src/lib");

/** Load `names` (and the libraries they import) as ES modules written under `runtime`. `read(name)` gives a library's
 * source (default: the working tree; pass one reading `git show` for an older commit). Returns the modules and the
 * SHA-256 of every source used. */
export async function loadLibs(names,{runtime,read=name=>fs.readFileSync(path.join(lib,`${name}.ts`),"utf8")}){
 fs.mkdirSync(runtime,{recursive:true});
 fs.writeFileSync(path.join(runtime,"package.json"),'{"type":"module"}');
 const hashes={},todo=[...names],done=new Set();
 while(todo.length){
  const name=todo.pop();
  if(done.has(name))continue;
  done.add(name);
  const source=read(name);
  hashes[name]=createHash("sha256").update(source).digest("hex");
  // type-only imports are gone after stripping, so only real dependencies are followed
  const js=stripTypeScriptTypes(source,{mode:"transform"}).replace(/(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(["'])\.\/([\w.-]+)\2/g,(_,before,quote,dep)=>{
   todo.push(dep);
   return `${before}${quote}./${dep}.mjs${quote}`;
  });
  fs.writeFileSync(path.join(runtime,`${name}.mjs`),js);
 }
 const modules={};
 for(const name of names)modules[name]=await import(pathToFileURL(path.join(runtime,`${name}.mjs`)).href);
 return {modules,hashes};
}
