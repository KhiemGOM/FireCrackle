// usage: node scripts/console-call.mjs "<expression>" [--port 9222]
// Evaluates an expression in the running FireCrackle window over WebView2 remote debugging (start the app with
// WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222) and prints the awaited result as JSON, e.g.
//   node scripts/console-call.mjs "firecrackle.guiProof({first:17117,last:17163,pair:'open',path:'D:/proofs/open.gif'})"
// The console API itself is src/lib/consoleApi.ts (window.firecrackle; firecrackle.help() lists the calls).
const args = process.argv.slice(2);
const portAt = args.indexOf('--port'), port = portAt >= 0 ? Number(args[portAt + 1]) : 9222;
const expression = args.filter((_, i) => portAt < 0 || (i !== portAt && i !== portAt + 1))[0];
if (!expression) { console.error('usage: node scripts/console-call.mjs "<expression>" [--port 9222]'); process.exit(2); }
const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json()).catch(() => null);
const page = pages?.find(p => p.type === 'page' && p.webSocketDebuggerUrl);
if (!page) { console.error(`No FireCrackle page on CDP port ${port}: start the app with remote debugging.`); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = () => fail(Error('CDP connection failed')); });
const reply = await new Promise(done => {
  ws.onmessage = event => { const m = JSON.parse(event.data); if (m.id === 1) done(m); };
  ws.send(JSON.stringify({id: 1, method: 'Runtime.evaluate', params: {expression, awaitPromise: true, returnByValue: true}}));
});
ws.close();
const result = reply.result;
if (reply.error || result?.exceptionDetails) {
  console.error(result?.exceptionDetails?.exception?.description ?? result?.exceptionDetails?.text ?? JSON.stringify(reply.error));
  process.exit(1);
}
console.log(JSON.stringify(result.result.value ?? result.result.description, null, 1));
