import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const maximumBytes = 5 * 1024 * 1024;
const wrappers = new Set(['fire-detection/mod/gradle/wrapper/gradle-wrapper.jar', 'fire-detection/mod-gui/gradle/wrapper/gradle-wrapper.jar']);
const secrets = [
  /\bgh[pousr]_[A-Za-z0-9]{36,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{60,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
];

/** Return only descriptions, never matching secret contents. */
export function inspectTrackedFile(path, bytes, content = '') {
  const problems = [];
  const p = path.replaceAll('\\', '/');
  if (/(^|\/)(?:node_modules|target|dist|build|__pycache__|releases|\.(gradle|board|claude|codex|agents|venv|release-(cache|worktrees)))(\/|$)/.test(p)) problems.push('generated/local tooling directory');
  if (/(?:^|\/)\.env(?:\..+)?$/.test(p) && !p.endsWith('.env.example')) problems.push('local environment file');
  if (/\.firecrackle(?:\/|$)/.test(p) || p.startsWith('fire-detection/data/joined/')) problems.push('private/generated video data');
  if (/\.(?:mp4|mkv|mov|avi|webm|exe|dll|zip|rar|7z|appimage|deb|rpm|tgz|tar\.gz|pem|key|class|tiny|mapping)$/i.test(p)) problems.push('binary, credential or upstream mapping artifact');
  if (/\.jar$/i.test(p) && !wrappers.has(p)) problems.push('JAR other than the Gradle wrapper');
  if (/(?:^|\/)(?:net\/minecraft|net\/fabricmc\/yarn)(?:\/|$)/.test(p)) problems.push('upstream Minecraft/Yarn source tree');
  if (/^\s*package\s+net\.(?:minecraft|fabricmc\.yarn)\b/m.test(content)) problems.push('upstream Minecraft/Yarn Java package');
  if (bytes > maximumBytes) problems.push('file exceeds 5 MiB source/fixture budget');
  if (secrets.some(pattern => pattern.test(content))) problems.push('possible credential/private key');
  return problems;
}

export function checkRepository() {
  const names = execFileSync('git', ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, 'ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
  const problems = [];
  for (const name of names) {
    try {
      const file = resolve(root, name);
      const bytes = statSync(file).size;
      const binary = /\.(?:png|ico|icns|rgba|jar)$/i.test(name);
      const content = binary || bytes > maximumBytes ? '' : readFileSync(file, 'utf8');
      for (const issue of inspectTrackedFile(name, bytes, content)) problems.push(`${name}: ${issue}`);
    } catch (error) { problems.push(`${name}: cannot inspect tracked file (${error.code ?? error.message})`); }
  }
  for (const required of ['README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'CONTRIBUTING.md', 'SECURITY.md']) {
    if (!names.includes(required)) problems.push(`${required}: required repository document is not tracked`);
  }
  return { files: names.length, problems };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = checkRepository();
  if (result.problems.length) {
    console.error(result.problems.join('\n'));
    process.exitCode = 1;
  } else console.log(`Repository hygiene passed (${result.files} tracked files). Minecraft/Yarn code, local data and generated artifacts remain outside Git.`);
}
