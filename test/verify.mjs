// Drive headless Edge over the Chrome DevTools Protocol (no npm dependencies).
// Opens the harness page, exercises the menu in real time, asserts results and
// saves screenshots. Usage: node test/verify.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EDGE = process.env.EDGE_PATH ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9333;
const here = path.dirname(fileURLToPath(import.meta.url));
const HARNESS = path.join(here, 'tree.html');
const OUT = path.join(here, 'out');
const PROFILE = path.join(os.tmpdir(), 'dsh-files-menu-cdp');

fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForVersion() {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (response.ok) return await response.json();
    } catch { /* not up yet */ }
    await sleep(100);
  }
  throw new Error('Edge DevTools endpoint never came up');
}

class CDP {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', () => resolve());
      this.ws.addEventListener('error', (event) => reject(new Error(`websocket error: ${event.message ?? 'unknown'}`)));
    });
    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id === undefined) return;
      const entry = this.pending.get(message.id);
      if (entry === undefined) return;
      this.pending.delete(message.id);
      if (message.error !== undefined) entry.reject(new Error(`${message.error.message} (${message.error.code})`));
      else entry.resolve(message.result);
    });
  }
  async send(method, params = {}) {
    await this.ready;
    const id = this.nextId++;
    const promise = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.ws.send(JSON.stringify({ id, method, params }));
    return promise;
  }
  close() { this.ws.close(); }
}

const results = [];
function check(name, ok, detail = '') {
  results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` :: ${detail}`}`);
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true
  });
  if (result.exceptionDetails !== undefined) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  }
  return result.result.value;
}

async function screenshot(cdp, name) {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  const file = path.join(OUT, name);
  fs.writeFileSync(file, Buffer.from(data, 'base64'));
  return file;
}

const OPEN = (selectorExpression, point) => `(() => {
  const element = ${selectorExpression};
  if (element === null) throw new Error('row not found');
  const box = element.getBoundingClientRect();
  const x = ${point === 'corner' ? 'window.innerWidth - 2' : 'box.left + 30'};
  const y = ${point === 'corner' ? 'window.innerHeight - 2' : 'box.top + box.height / 2'};
  element.dispatchEvent(new MouseEvent('contextmenu', {
    bubbles: true, cancelable: true, button: 2, clientX: x, clientY: y
  }));
  return { x, y };
})()`;

const FILE_ROW = `document.querySelector('[data-dfm-test="file"]')`;
const DIR_ROW = `document.querySelector('[data-dfm-test="dir"]')`;
const NESTED_ROW = `document.querySelector('[data-dfm-test="nested"]')`;

async function main() {
  fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 3 });

  const child = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--disable-extensions',
    '--hide-scrollbars', '--window-size=1180,760',
    `--remote-debugging-port=${PORT}`, '--remote-allow-origins=*',
    `--user-data-dir=${PROFILE}`, 'about:blank'
  ], { stdio: 'ignore' });

  let cdp;
  try {
    await waitForVersion();
    const url = `file:///${HARNESS.replace(/\\/g, '/')}`;
    const target = await (await fetch(`http://127.0.0.1:${PORT}/json/new`, { method: 'PUT' })).json();
    cdp = new CDP(target.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1180, height: 760, deviceScaleFactor: 2, mobile: false
    });
    await cdp.send('Page.navigate', { url });
    for (let attempt = 0; attempt < 100; attempt++) {
      const ready = await evaluate(cdp, `document.readyState === 'complete' && typeof window.__plugin === 'object'`).catch(() => false);
      if (ready === true) break;
      await sleep(100);
    }
    check('harness page loaded', (await evaluate(cdp, 'location.href')).startsWith('file:///'), await evaluate(cdp, 'location.href'));
    await sleep(250);

    check('bundle applies without errors', (await evaluate(cdp, 'window.__errors.length')) === 0,
      String(await evaluate(cdp, 'JSON.stringify(window.__errors)')));

    // 1. File row menu, contents and styling hooks.
    await evaluate(cdp, OPEN(FILE_ROW));
    await sleep(120);
    const fileMenu = await evaluate(cdp, `(() => {
      const menu = document.querySelector('[data-dfm-menu]');
      if (menu === null) return { present: false };
      const box = menu.getBoundingClientRect();
      const style = getComputedStyle(menu);
      return {
        present: true,
        role: menu.getAttribute('role'),
        labels: [...menu.querySelectorAll('.dfm-label')].map((node) => node.textContent),
        itemRole: [...menu.querySelectorAll('.dfm-item')].every((node) => node.getAttribute('role') === 'menuitem'),
        activeRow: document.querySelector('li[data-dfm-active]')?.getAttribute('data-files-path') ?? null,
        position: style.position,
        zIndex: style.zIndex,
        rect: { left: Math.round(box.left), top: Math.round(box.top), width: Math.round(box.width), height: Math.round(box.height) },
        firstFocused: document.activeElement?.dataset.dfmAction ?? null
      };
    })()`);
    check('file menu opens', fileMenu.present === true);
    check('file menu role=menu', fileMenu.role === 'menu');
    check('file menu items', JSON.stringify(fileMenu.labels) === JSON.stringify([
      '打开', '复制文件地址', '复制相对路径', '复制文件名', '在资源管理器中显示'
    ]), JSON.stringify(fileMenu.labels));
    check('every item is a menuitem', fileMenu.itemRole === true);
    check('row highlighted while open', fileMenu.activeRow !== null, String(fileMenu.activeRow));
    check('pointer opening does not steal focus', fileMenu.firstFocused === null, String(fileMenu.firstFocused));
    check('menu is fixed and above content', fileMenu.position === 'fixed' && Number(fileMenu.zIndex) >= 1000);
    await screenshot(cdp, 'menu-light.png');

    // 2. Copy actions.
    await evaluate(cdp, `document.querySelector('[data-dfm-action="copy-path"]').click()`);
    await sleep(150);
    check('copy file path', (await evaluate(cdp, 'window.__copied.at(-1)')) === 'E:\\DSHProject\\BG\\README.md',
      JSON.stringify(await evaluate(cdp, 'window.__copied')));
    check('toast shows 已复制', (await evaluate(cdp, `document.querySelector('.dfm-toast')?.textContent ?? null`)) === '已复制');
    check('menu closes after choosing', (await evaluate(cdp, `document.querySelector('[data-dfm-menu]') === null`)) === true);

    await evaluate(cdp, OPEN(NESTED_ROW));
    await sleep(100);
    await evaluate(cdp, `document.querySelector('[data-dfm-action="copy-relative"]').click()`);
    await sleep(150);
    check('copy nested relative path', (await evaluate(cdp, 'window.__copied.at(-1)')) === 'refs/README.md',
      String(await evaluate(cdp, 'window.__copied.at(-1)')));

    await evaluate(cdp, OPEN(FILE_ROW));
    await sleep(100);
    await evaluate(cdp, `document.querySelector('[data-dfm-action="copy-name"]').click()`);
    await sleep(150);
    check('copy file name', (await evaluate(cdp, 'window.__copied.at(-1)')) === 'README.md');

    // 3. Reveal on the desktop and opening a row.
    await evaluate(cdp, OPEN(FILE_ROW));
    await sleep(100);
    await evaluate(cdp, `document.querySelector('[data-dfm-action="reveal"]').click()`);
    await sleep(150);
    check('reveal sends path and reveal action',
      JSON.stringify(await evaluate(cdp, 'window.__revealed.at(-1)')) === JSON.stringify({ path: 'E:\\DSHProject\\BG\\README.md', action: 'reveal' }),
      JSON.stringify(await evaluate(cdp, 'window.__revealed')));

    await evaluate(cdp, OPEN(FILE_ROW));
    await sleep(100);
    await evaluate(cdp, `document.querySelector('[data-dfm-action="open"]').click()`);
    await sleep(100);
    check('open clicks the row', (await evaluate(cdp, 'window.__opened.at(-1)')) === 'README.md');

    // 4. Directory rows, dark theme screenshot.
    await evaluate(cdp, `document.documentElement.setAttribute('data-dfm-dark', '')`);
    await evaluate(cdp, OPEN(DIR_ROW));
    await sleep(120);
    const dirMenu = await evaluate(cdp, `(() => {
      const menu = document.querySelector('[data-dfm-menu]');
      return { labels: [...menu.querySelectorAll('.dfm-label')].map((node) => node.textContent),
               background: getComputedStyle(menu.querySelector('.dfm-material')).backgroundColor };
    })()`);
    check('expanded directory menu', JSON.stringify(dirMenu.labels) === JSON.stringify([
      '折叠文件夹', '复制文件夹地址', '复制相对路径', '复制文件夹名', '在资源管理器中打开'
    ]), JSON.stringify(dirMenu.labels));
    await screenshot(cdp, 'menu-dark.png');
    await evaluate(cdp, `document.querySelector('[data-dfm-action="copy-path"]').click()`);
    await sleep(150);
    check('copy folder path', (await evaluate(cdp, 'window.__copied.at(-1)')) === 'E:\\DSHProject\\BG\\refs');

    await evaluate(cdp, OPEN(DIR_ROW));
    await sleep(100);
    await evaluate(cdp, `document.querySelector('[data-dfm-action="open-directory"]').click()`);
    await sleep(150);
    check('open folder sends the path only',
      JSON.stringify(await evaluate(cdp, 'window.__revealed.at(-1)')) === JSON.stringify({ path: 'E:\\DSHProject\\BG\\refs' }));

    // 5. Clamping at the bottom-right corner.
    await evaluate(cdp, `document.documentElement.removeAttribute('data-dfm-dark')`);
    await evaluate(cdp, OPEN(FILE_ROW, 'corner'));
    await sleep(120);
    const corner = await evaluate(cdp, `(() => {
      const box = document.querySelector('[data-dfm-menu]').getBoundingClientRect();
      return { left: box.left, top: box.top, right: box.right, bottom: box.bottom,
               width: innerWidth, height: innerHeight };
    })()`);
    check('menu is clamped into the viewport',
      corner.left >= 0 && corner.top >= 0 && corner.right <= corner.width && corner.bottom <= corner.height,
      JSON.stringify(corner));
    await screenshot(cdp, 'menu-corner.png');

    // 6. Dismissal and keyboard access.
    await evaluate(cdp, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`);
    await sleep(80);
    check('escape closes the menu', (await evaluate(cdp, `document.querySelector('[data-dfm-menu]') === null`)) === true);

    await evaluate(cdp, `${FILE_ROW}.focus()`);
    await evaluate(cdp, `${FILE_ROW}.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true, cancelable: true }))`);
    await sleep(100);
    check('shift+F10 opens the menu', (await evaluate(cdp, `document.querySelector('[data-dfm-menu]') !== null`)) === true);
    check('keyboard opening focuses the first item',
      (await evaluate(cdp, `document.activeElement?.dataset.dfmAction ?? null`)) === 'open');
    await evaluate(cdp, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))`);
    await sleep(60);
    check('arrow keys move focus',
      (await evaluate(cdp, `document.activeElement?.dataset.dfmAction ?? null`)) === 'copy-path');

    // 7. Ignored targets and outside dismissal.
    await evaluate(cdp, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`);
    await sleep(60);
    await evaluate(cdp, `(() => {
      const header = document.querySelector('.header [data-files-path]');
      header.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 900, clientY: 40 }));
      const other = document.querySelector('li[data-files-entry="other"]');
      other.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 900, clientY: 300 }));
    })()`);
    await sleep(80);
    check('header and non-file rows are ignored', (await evaluate(cdp, `document.querySelector('[data-dfm-menu]') === null`)) === true);

    await evaluate(cdp, OPEN(FILE_ROW));
    await sleep(80);
    await evaluate(cdp, `document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }))`);
    await sleep(80);
    check('outside pointer closes the menu', (await evaluate(cdp, `document.querySelector('[data-dfm-menu]') === null`)) === true);

    // 8. Full reload-based self test in the same page.
    await cdp.send('Page.navigate', { url: `file:///${HARNESS.replace(/\\/g, '/')}?selftest=1` });
    for (let attempt = 0; attempt < 100; attempt++) {
      const done = await evaluate(cdp, `document.title.startsWith('SELFTEST')`).catch(() => false);
      if (done === true) break;
      await sleep(100);
    }
    const title = await evaluate(cdp, 'document.title');
    const report = await evaluate(cdp, `document.getElementById('dfm-results').textContent`);
    check('in-page selftest passes', title === 'SELFTEST-PASS', title);
    for (const line of report.split('\n')) results.push(`  ${line}`);
  } finally {
    cdp?.close();
    child.kill('SIGKILL');
    await sleep(300);
  }

  console.log(results.join('\n'));
  const failed = results.filter((line) => line.startsWith('FAIL'));
  console.log(`\n# ${results.filter((line) => line.startsWith('PASS')).length} passed, ${failed.length} failed`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('verify failed:', error);
  process.exit(2);
});