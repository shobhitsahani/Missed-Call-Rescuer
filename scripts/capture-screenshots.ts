import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import WebSocket from 'ws';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const TEMP_USER_DATA = path.join(process.env.TEMP || 'C:\\Temp', `chrome_cdp_${Date.now()}`);

function sendCommand(ws: WebSocket, id: number, method: string, params: any = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    const handler = (data: WebSocket.RawData) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.id === id) {
          ws.off('message', handler);
          if (msg.error) reject(new Error(msg.error.message));
          else resolve(msg.result);
        }
      } catch {
        // ignore other messages
      }
    };
    ws.on('message', handler);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function captureUrl(browserWsUrl: string, url: string, outputPath: string) {
  const browserWs = new WebSocket(browserWsUrl);
  await new Promise((res) => browserWs.on('open', res));

  // Create new page target
  const { targetId } = await sendCommand(browserWs, 1, 'Target.createTarget', { url });
  browserWs.close();

  // Connect directly to page target
  const pageWs = new WebSocket(`ws://127.0.0.1:9222/devtools/page/${targetId}`);
  await new Promise((res) => pageWs.on('open', res));

  await sendCommand(pageWs, 2, 'Page.enable');
  await sendCommand(pageWs, 3, 'Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });

  // Wait 2 seconds for client hydration and data load
  await new Promise((r) => setTimeout(r, 2000));

  const screenshot = await sendCommand(pageWs, 4, 'Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(outputPath, Buffer.from(screenshot.data, 'base64'));
  console.log(`Saved screenshot to: ${outputPath}`);

  await sendCommand(pageWs, 5, 'Target.closeTarget', { targetId });
  pageWs.close();
}

async function main() {
  console.log('Launching headless Chrome with CDP...');
  const chromeProc = spawn(CHROME_PATH, [
    '--headless=new',
    '--remote-debugging-port=9222',
    `--user-data-dir=${TEMP_USER_DATA}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
  ]);

  // Wait for debugger port
  let browserWsUrl = '';
  for (let i = 0; i < 20; i++) {
    try {
      const res = await fetch('http://127.0.0.1:9222/json/version');
      const data = await res.json();
      browserWsUrl = data.webSocketDebuggerUrl;
      if (browserWsUrl) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }

  if (!browserWsUrl) {
    chromeProc.kill();
    throw new Error('Failed to connect to Chrome DevTools port 9222');
  }

  const publicDir = path.join(process.cwd(), 'public');
  if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });

  // 1. Dashboard screenshot
  console.log('Capturing Dashboard screenshot...');
  const dashboardPng = path.join(publicDir, 'dashboard.png');
  await captureUrl(browserWsUrl, 'http://localhost:3010', dashboardPng);

  // 2. Call interface screenshot: simulate a call first
  console.log('Simulating call for Call Page screenshot...');
  const simRes = await fetch('http://localhost:4000/api/missed-calls/simulate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '+1 (555) 019-8877' }),
  });
  const simData = await simRes.json();
  const callUrl = `http://localhost:3010/call/${simData.missedCallId}`;

  console.log(`Capturing Call Page screenshot at ${callUrl}...`);
  const callPng = path.join(publicDir, 'call-interface.png');
  await captureUrl(browserWsUrl, callUrl, callPng);

  chromeProc.kill();
  try {
    fs.rmSync(TEMP_USER_DATA, { recursive: true, force: true });
  } catch {}

  console.log('Done capturing screenshots!');
}

main().catch((err) => {
  console.error('Screenshot capture failed:', err);
  process.exit(1);
});
