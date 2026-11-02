/**
 * Headless browser smoke test for the customer call page.
 * Uses Chrome DevTools Protocol (no Playwright dependency).
 */
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import WebSocket from 'ws';

const WEB_BASE = 'http://localhost:3010';
const API_BASE = 'http://localhost:4000';
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const DEBUG_PORT = 9224;
const TEMP_USER_DATA = path.join(process.env.TEMP || 'C:\\Temp', `chrome_call_${Date.now()}`);

function sendCommand(ws: WebSocket, id: number, method: string, params: Record<string, unknown> = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    const handler = (data: WebSocket.RawData) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.id === id) {
          ws.off('message', handler);
          if (msg.error) reject(new Error(msg.error.message));
          else resolve(msg.result);
        }
      } catch {}
    };
    ws.on('message', handler);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const sim = await fetch(`${API_BASE}/api/missed-calls/simulate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '+1 (555) 010-7788', source: 'test' }),
  });
  if (!sim.ok) throw new Error(`simulate failed: ${sim.status}`);
  const simData = await sim.json();
  const callUrl = `${WEB_BASE}/call/${simData.token}`;

  const chrome = spawn(CHROME_PATH, [
    '--headless=new',
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${TEMP_USER_DATA}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
    callUrl,
  ]);

  let wsUrl = '';
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
      const data = await res.json();
      wsUrl = data.webSocketDebuggerUrl;
      if (wsUrl) break;
    } catch {}
    await sleep(300);
  }
  if (!wsUrl) throw new Error('Chrome DevTools did not start');

  const browser = new WebSocket(wsUrl);
  await new Promise((res) => browser.on('open', res));

  const targets = await sendCommand(browser, 1, 'Target.getTargets');
  const pageTarget = (targets.targetInfos as any[]).find((t) => t.type === 'page' && t.url.includes('/call/'));
  if (!pageTarget) throw new Error('Call page target not found');
  const page = new WebSocket(`ws://127.0.0.1:${DEBUG_PORT}/devtools/page/${pageTarget.targetId}`);
  await new Promise((res) => page.on('open', res));

  const consoleErrors: string[] = [];
  page.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        consoleErrors.push(msg.params.args.map((a: any) => a.value || a.description || '').join(' '));
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        consoleErrors.push(msg.params.exceptionDetails?.text || 'exception');
      }
    } catch {}
  });

  await sendCommand(page, 2, 'Page.enable');
  await sendCommand(page, 3, 'Runtime.enable');
  await sendCommand(page, 4, 'Browser.grantPermissions', {
    origin: WEB_BASE,
    permissions: ['audioCapture'],
  }).catch(() => {});

  const bodyText = async () => {
    const r = await sendCommand(page, 100 + Math.floor(Math.random() * 1000), 'Runtime.evaluate', {
      expression: 'document.body.innerText',
      returnByValue: true,
    });
    return String(r.result?.value || '');
  };

  let text = '';
  for (let i = 0; i < 30; i++) {
    text = await bodyText();
    if (text.includes('Start call')) break;
    await sleep(500);
  }
  if (!text.includes('Start call')) throw new Error(`Start call button never rendered. Body: ${text.slice(0, 300)}`);
  console.log('✓ Call page rendered with a valid token (Start call visible).');

  await sendCommand(page, 5, 'Runtime.evaluate', {
    expression: `(() => { const b = Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes('Start call')); if (b) { b.click(); return true; } return false; })()`,
    returnByValue: true,
  });

  let greetingSeen = false;
  for (let i = 0; i < 60; i++) {
    text = await bodyText();
    if (/automated assistant calling on behalf of/i.test(text)) {
      greetingSeen = true;
      break;
    }
    await sleep(500);
  }

  const shot = await sendCommand(page, 6, 'Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(process.env.TEMP || 'C:\\Temp', 'call-page-after-start.png'), Buffer.from(shot.data, 'base64'));

  if (!greetingSeen) {
    console.log('BODY:', text.slice(0, 800));
    throw new Error('Greeting transcript did not appear after Start call');
  }
  console.log('✓ Live greeting transcript rendered in the browser.');
  console.log(`✓ Console errors: ${consoleErrors.length}`);

  const endClicked = await sendCommand(page, 7, 'Runtime.evaluate', {
    expression: `(() => { const b = Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes('End call')); if (b) { b.click(); return true; } return false; })()`,
    returnByValue: true,
  });
  if (!endClicked.result?.value) throw new Error('End call button not found');

  let summarySeen = false;
  for (let i = 0; i < 90; i++) {
    text = await bodyText();
    if (/Call Summary|Summary/i.test(text) && !/Ending call/i.test(text)) {
      summarySeen = true;
      break;
    }
    await sleep(500);
  }
  if (!summarySeen) {
    console.log('BODY AFTER END:', text.slice(-1200));
    throw new Error('Summary did not render after ending the call');
  }
  console.log('✓ Summary rendered after ending the call.');
  console.log(`✓ CONSOLE_ERRORS=${consoleErrors.length}${consoleErrors.length ? ' ' + consoleErrors.slice(0, 3).join(' | ') : ''}`);

  page.close();
  browser.close();
  chrome.kill();
  try { fs.rmSync(TEMP_USER_DATA, { recursive: true, force: true }); } catch {}
}

main().catch((err) => {
  console.error('UI call smoke test failed:', err);
  process.exit(1);
});
