const port = process.env.YTM_DEBUG_PORT || '9222';
const arg = process.argv[2];

(async () => {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  if (arg === '--targets') {
    for (const t of targets) console.log(`${t.type}\t${t.url}`);
    return;
  }
  const page =
    targets.find((t) => t.type === 'page' && /music\.youtube\.com/.test(t.url)) ||
    targets.find((t) => t.type === 'page');
  if (!page) {
    console.error('page target 없음');
    process.exit(1);
  }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  ws.onopen = () =>
    ws.send(
      JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: { expression: arg, awaitPromise: true, returnByValue: true },
      }),
    );
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id === 1) {
      console.log(JSON.stringify(d.result?.result?.value ?? d.result, null, 2));
      ws.close();
    }
  };
  ws.onerror = () => {
    console.error('WebSocket 오류');
    process.exit(1);
  };
})();
