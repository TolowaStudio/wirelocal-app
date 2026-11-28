import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { speakSamples } from '../src/data/speak-samples.ts';

const root = path.resolve(import.meta.dirname, '..');
const distDir = path.join(root, 'dist');

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

function findChrome() {
  if (process.env.CHROME) {
    if (!existsSync(process.env.CHROME)) {
      throw new Error(`CHROME binary not found at ${process.env.CHROME}`);
    }
    return process.env.CHROME;
  }

  for (const bin of ['google-chrome', 'chromium', 'chromium-browser']) {
    try {
      const resolved = execFileSync('which', [bin], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      if (resolved) return resolved;
    } catch {}
  }

  for (const macPath of [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ]) {
    if (existsSync(macPath)) return macPath;
  }

  for (const cache of [
    path.join(homedir(), '.cache/ms-playwright'),
    path.join(homedir(), 'Library/Caches/ms-playwright'),
  ]) {
    if (!existsSync(cache)) continue;
    for (const dir of readdirSync(cache).sort().reverse()) {
      for (const rel of [
        'chrome-headless-shell-linux64/chrome-headless-shell',
        'chrome-headless-shell-mac-arm64/chrome-headless-shell',
        'chrome-headless-shell-mac-x64/chrome-headless-shell',
        'chrome-linux64/chrome',
        'chrome-linux/chrome',
        'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
        'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
      ]) {
        const candidate = path.join(cache, dir, rel);
        if (existsSync(candidate)) return candidate;
      }
    }
  }

  throw new Error('No Chrome or Chromium binary found. Set CHROME=/path/to/chrome.');
}

function serveDist(dir) {
  const server = createServer((req, res) => {
    const reqPath = decodeURIComponent((req.url || '/').split('?')[0]);
    const rel = reqPath.replace(/^\/+/, '');
    let filePath = path.resolve(dir, rel || 'index.html');
    if (reqPath.endsWith('/')) filePath = path.resolve(dir, rel, 'index.html');
    if (!existsSync(filePath) && existsSync(`${filePath}/index.html`)) {
      filePath = path.join(filePath, 'index.html');
    }

    const relative = path.relative(dir, filePath);
    if (relative.startsWith('..') || path.isAbsolute(relative) || !existsSync(filePath)) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    const mime = MIME_TYPES[path.extname(filePath)] ?? 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(readFileSync(filePath));
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

class CdpClient {
  #ws;
  #nextId = 1;
  #pending = new Map();
  #eventWaiters = new Map();

  constructor(ws) {
    this.#ws = ws;
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(String(event.data));
      if (msg.id !== undefined) {
        const entry = this.#pending.get(msg.id);
        if (!entry) return;
        this.#pending.delete(msg.id);
        clearTimeout(entry.timer);
        if (msg.error) {
          entry.reject(new Error(`CDP ${entry.method}: ${msg.error.message}`));
        } else {
          entry.resolve(msg.result);
        }
        return;
      }

      const waiters = this.#eventWaiters.get(msg.method);
      if (!waiters) return;
      for (const w of [...waiters]) {
        if (w.predicate(msg.params)) {
          waiters.delete(w);
          clearTimeout(w.timer);
          w.resolve(msg.params);
        }
      }
    });
  }

  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', () => reject(new Error(`Failed to connect to CDP at ${wsUrl}`)), { once: true });
    });
    return new CdpClient(ws);
  }

  send(method, params = {}, timeoutMs = 10000) {
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`CDP timeout waiting for ${method}`));
      }, timeoutMs);
      this.#pending.set(id, { method, resolve, reject, timer });
      this.#ws.send(JSON.stringify({ id, method, params }));
    });
  }

  waitForEvent(method, predicate = () => true, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const waiters = this.#eventWaiters.get(method) ?? new Set();
      this.#eventWaiters.set(method, waiters);
      const entry = {
        predicate,
        resolve,
        timer: setTimeout(() => {
          waiters.delete(entry);
          reject(new Error(`CDP timeout waiting for event ${method}`));
        }, timeoutMs),
      };
      waiters.add(entry);
    });
  }

  async evalJs(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (res.exceptionDetails) {
      const msg = res.exceptionDetails.exception?.description || res.exceptionDetails.text;
      throw new Error(`Page evaluation error: ${msg}`);
    }
    return res.result?.value;
  }

  async pressKey({ key, code, keyCode, text }) {
    const base = {
      key,
      code,
      windowsVirtualKeyCode: keyCode,
      nativeVirtualKeyCode: keyCode,
    };
    await this.send('Input.dispatchKeyEvent', {
      ...base,
      type: 'keyDown',
      ...(text ? { text, unmodifiedText: text } : {}),
    });
    await this.send('Input.dispatchKeyEvent', {
      ...base,
      type: 'keyUp',
    });
  }

  close() {
    for (const entry of this.#pending.values()) clearTimeout(entry.timer);
    this.#pending.clear();
    for (const waiters of this.#eventWaiters.values()) {
      for (const w of waiters) clearTimeout(w.timer);
    }
    this.#eventWaiters.clear();
    this.#ws.close();
  }
}

async function launchBrowser() {
  const chrome = findChrome();
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'wirelocal-chrome-'));
  const child = spawn(
    chrome,
    [
      '--headless',
      '--remote-debugging-port=0',
      '--no-sandbox',
      '--disable-gpu',
      '--no-proxy-server',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      `--user-data-dir=${userDataDir}`,
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );

  let stderr = '';
  const debugPort = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for Chrome DevTools port. stderr:\n${stderr}`));
    }, 10000);

    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
      const match = stderr.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//);
      if (match) {
        clearTimeout(timer);
        resolve(Number(match[1]));
      }
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Chrome exited prematurely with code ${code}. stderr:\n${stderr}`));
    });
  });

  const targets = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((r) => r.json());
  const pageTarget = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  if (!pageTarget) {
    throw new Error(`No page target found on DevTools port ${debugPort}`);
  }

  const cdp = await CdpClient.connect(pageTarget.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  return {
    cdp,
    async goto(url, { width = 1280, height = 900, reducedMotion = 'no-preference' } = {}) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await cdp.send('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-reduced-motion', value: reducedMotion }],
      });
      const loadPromise = cdp.waitForEvent('Page.loadEventFired', () => true, 20000);
      await cdp.send('Page.navigate', { url });
      await loadPromise;
    },
    async close() {
      cdp.close();
      child.kill('SIGTERM');
      await new Promise((resolve) => {
        const timer = setTimeout(() => {
          child.kill('SIGKILL');
          resolve();
        }, 2000);
        child.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      });
      rmSync(userDataDir, { recursive: true, force: true });
    },
  };
}

let server;
let browser;
let baseUrl;

before(async () => {
  if (!existsSync(path.join(distDir, 'index.html'))) {
    throw new Error('dist/index.html not found. Run `npm run build` before `npm run test:browser`.');
  }
  server = await serveDist(distDir);
  baseUrl = `http://127.0.0.1:${server.address().port}/`;
  browser = await launchBrowser();
});

after(async () => {
  if (browser) await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
});

test('keyboard: Enter and Space on Speak mode button flip aria-pressed and visible sample tone', async () => {
  await browser.goto(baseUrl, { width: 1280, height: 900 });

  const readState = () =>
    browser.cdp.evalJs(`(() => {
      const btn = document.querySelector('[data-speak-toggle]');
      if (!btn) return { missing: true };
      const isVisible = (el) => !el.hidden && getComputedStyle(el).display !== 'none';
      const standard = [...document.querySelectorAll('#speak-samples [data-tone="standard"]')].map((el) => ({
        text: el.textContent?.trim(),
        visible: isVisible(el),
      }));
      const brainrot = [...document.querySelectorAll('#speak-samples [data-tone="brainrot"]')].map((el) => ({
        text: el.textContent?.trim(),
        visible: isVisible(el),
      }));
      return {
        missing: false,
        buttonVisible: isVisible(btn),
        ariaPressed: btn.getAttribute('aria-pressed'),
        focused: document.activeElement === btn,
        standard,
        brainrot,
      };
    })()`);

  const initial = await readState();
  assert.equal(initial.missing, false, 'Speak mode toggle button should exist');
  assert.equal(initial.buttonVisible, true, 'Speak mode toggle button should be visible when JS runs');
  assert.equal(initial.ariaPressed, 'false');
  assert.deepEqual(
    initial.standard,
    speakSamples.map((s) => ({ text: s.standard, visible: true })),
  );
  assert.deepEqual(
    initial.brainrot,
    speakSamples.map((s) => ({ text: s.brainrot, visible: false })),
  );

  await browser.cdp.evalJs(`document.querySelector('[data-speak-toggle]')?.focus()`);
  const afterFocus = await readState();
  assert.equal(afterFocus.focused, true, 'Speak mode button must be focusable');

  // Press Enter -> switches to Brainrot
  await browser.cdp.pressKey({ key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' });
  const afterEnter = await readState();
  assert.equal(afterEnter.ariaPressed, 'true', 'Enter must flip aria-pressed to true');
  assert.deepEqual(
    afterEnter.standard,
    speakSamples.map((s) => ({ text: s.standard, visible: false })),
  );
  assert.deepEqual(
    afterEnter.brainrot,
    speakSamples.map((s) => ({ text: s.brainrot, visible: true })),
  );

  // Press Space -> switches back to Standard
  await browser.cdp.pressKey({ key: ' ', code: 'Space', keyCode: 32, text: ' ' });
  const afterSpace = await readState();
  assert.equal(afterSpace.ariaPressed, 'false', 'Space must flip aria-pressed back to false');
  assert.deepEqual(
    afterSpace.standard,
    speakSamples.map((s) => ({ text: s.standard, visible: true })),
  );
  assert.deepEqual(
    afterSpace.brainrot,
    speakSamples.map((s) => ({ text: s.brainrot, visible: false })),
  );
});

test('360px viewport: no horizontal overflow in Standard or Brainrot mode', async () => {
  await browser.goto(baseUrl, { width: 360, height: 900 });

  const measure = () =>
    browser.cdp.evalJs(`(() => {
      const btn = document.querySelector('[data-speak-toggle]');
      return {
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        ariaPressed: btn?.getAttribute('aria-pressed'),
      };
    })()`);

  const standard = await measure();
  assert.equal(standard.clientWidth, 360);
  assert.equal(standard.ariaPressed, 'false');
  assert.ok(
    standard.scrollWidth <= 360,
    `Expected scrollWidth <= 360 in Standard mode, got ${standard.scrollWidth}`,
  );

  await browser.cdp.evalJs(`document.querySelector('[data-speak-toggle]')?.click()`);

  const brainrot = await measure();
  assert.equal(brainrot.ariaPressed, 'true');
  assert.ok(
    brainrot.scrollWidth <= 360,
    `Expected scrollWidth <= 360 in Brainrot mode, got ${brainrot.scrollWidth}`,
  );
});

test('prefers-reduced-motion: reduce sets the toggle transition duration to 0s', async () => {
  await browser.goto(baseUrl, { width: 1280, height: 900, reducedMotion: 'no-preference' });

  const readDurations = () =>
    browser.cdp.evalJs(`(() => {
      const btn = document.querySelector('[data-speak-toggle]');
      const sw = btn?.querySelector('.switch');
      return {
        button: getComputedStyle(btn).transitionDuration,
        switchTrack: getComputedStyle(sw).transitionDuration,
        switchThumb: getComputedStyle(sw, '::after').transitionDuration,
      };
    })()`);

  const normal = await readDurations();
  assert.notEqual(normal.button, '0s', 'Expected non-zero transition duration with no-preference');
  assert.notEqual(normal.switchTrack, '0s');
  assert.notEqual(normal.switchThumb, '0s');

  await browser.cdp.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  });

  const reduced = await readDurations();
  assert.equal(reduced.button, '0s', 'Expected 0s transition duration on .toggle under reduced motion');
  assert.equal(reduced.switchTrack, '0s', 'Expected 0s transition duration on .switch under reduced motion');
  assert.equal(reduced.switchThumb, '0s', 'Expected 0s transition duration on .switch::after under reduced motion');
});
