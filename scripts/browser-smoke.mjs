// Optional local UI verification using installed Chrome; no browser dependency.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const chrome = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const base = process.env.DOCS2API_TEST_URL || 'http://127.0.0.1:4000';
const dir = resolve('.docs2api/browser-test'); mkdirSync(dir, { recursive: true });
const child = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=9228', '--remote-allow-origins=http://localhost:9228', '--user-data-dir=' + dir, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
let ws; let target;
const wait = ms => new Promise(r => setTimeout(r, ms));
try {
  let pages;
  for (let i = 0; i < 40; i++) { try { pages = await (await fetch('http://localhost:9228/json/list')).json(); break; } catch { await wait(250); } }
  target = pages?.find(p => p.type === 'page'); if (!target) throw new Error('Chrome did not expose a page.');
  ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const calls = new Map(); const errors = [];
  ws.onmessage = event => { const message = JSON.parse(event.data); if (message.id) { const pending = calls.get(message.id); if (pending) { calls.delete(message.id); message.error ? pending.reject(new Error(JSON.stringify(message.error))) : pending.resolve(message.result); } } if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text); };
  function send(method, params = {}) { return new Promise((resolve, reject) => { const current = ++id; calls.set(current, { resolve, reject }); ws.send(JSON.stringify({ id: current, method, params })); }); }
  const evaluate = async expression => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r.result.value; };
  const click = text => evaluate(`(() => { const el = [...document.querySelectorAll('button')].find(e=>e.textContent.trim() === ${JSON.stringify(text)} || [...e.children].some(c=>c.tagName==='SPAN' && c.textContent.trim() === ${JSON.stringify(text)})); if(!el) throw new Error('Button missing: '+${JSON.stringify(text)}); el.click(); return true; })()`);
  async function until(expression) { for (let i = 0; i < 80; i++) { if (await evaluate(expression)) return; await wait(200); } throw new Error('UI wait failed: ' + expression); }
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1050, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: base });
  await until(`document.body.innerText.includes('Agrega tu documentaci\u00f3n')`);
  await wait(400);
  let shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }); writeFileSync(resolve('.docs2api/catalog.png'), Buffer.from(shot.data, 'base64'));
  await evaluate(`document.querySelector('.home-actions .button').click()`);
  await until(`document.querySelector('[role=dialog]') !== null`);
  await evaluate(`document.querySelector('button[aria-label=\"Cerrar\"]').click()`);
  await click('Cat\u00e1logo de APIs');
  await until(`document.body.innerText.includes('Nuestro cat\u00e1logo est\u00e1 en camino')`);
  await evaluate(`fetch('/api/integrations/catalog',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:'inegi'})}).then(r=>r.json())`);
  await send('Page.reload');
  await until(`document.querySelector('.home-actions') !== null`);
  await click('Mis sandboxes');
  await until(`document.querySelector('.request-title')?.innerText.includes('Consultar un indicador')`);
  await click('Enviar');
  await until(`document.querySelector('.response-body')?.innerText.includes('OBSERVATIONS')`);
  shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }); writeFileSync(resolve('.docs2api/sandbox.png'), Buffer.from(shot.data, 'base64'));
  await evaluate(`(() => { const s = document.querySelector('.scenario-bar select'); s.value='error'; s.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  await wait(600); await click('Enviar'); await until(`document.querySelector('.response-heading')?.innerText.includes('500')`);
  await click('Pausar'); await until(`document.body.innerText.includes('SANDBOX PAUSADO')`); await click('Iniciar');
  await until(`document.body.innerText.includes('SANDBOX ACTIVO')`);
  await click('Migrar a real'); await until(`document.body.innerText.includes('Proponer migración')`);
  await click('Ajustes'); await until(`document.body.innerText.includes('Proveedor de inteligencia artificial')`);
  const providerOptions = await evaluate(`document.querySelector('select[aria-label="Proveedor de IA"]').options.length`); if (providerOptions !== 3) throw new Error('Missing provider options.');
  await click('Catálogo de APIs');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await wait(400);
  const overflow = await evaluate('document.documentElement.scrollWidth > innerWidth'); if (overflow) throw new Error('Mobile horizontal overflow.');
  shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }); writeFileSync(resolve('.docs2api/mobile.png'), Buffer.from(shot.data, 'base64'));
  if (errors.length) throw new Error('Browser errors: ' + errors.join('; '));
  console.log('UI smoke passed: catalog, create, request, scenarios, pause/start, migration, settings, mobile.');
} finally {
  if (ws?.readyState === WebSocket.OPEN) { ws.send(JSON.stringify({ id: 99999, method: 'Browser.close' })); ws.close(); }
  else child.kill();
}
