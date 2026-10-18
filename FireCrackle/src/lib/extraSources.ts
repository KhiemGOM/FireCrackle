const KEY = "firecrackle.extra-texture-sources.v1";

/** App-wide opt-in; existing projects never implicitly enable extra tools. */
export function readExtraSources(): boolean {
  try { return localStorage.getItem(KEY) === "true"; } catch { return false; }
}

export function saveExtraSources(enabled: boolean): void {
  try { localStorage.setItem(KEY, String(enabled)); } catch { /* Session still works without storage. */ }
}
