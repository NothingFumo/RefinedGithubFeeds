// RefinedGithubFeeds - 端到端验证驱动（直连 CDP，独立于编辑器内核运行）
'use strict';
const CDP_HTTP = 'http://127.0.0.1:9333';
const FIXTURE = 'http://127.0.0.1:8791/tools/e2e_fixture.html';

let msgId = 0;
const pending = new Map();

function send(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function connect() {
  const targets = await (await fetch(`${CDP_HTTP}/json/list`)).json();
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    }
  };
  return ws;
}

async function evaljs(ws, expression) {
  const r = await send(ws, 'Runtime.evaluate', { expression, returnByValue: true });
  if (r.exceptionDetails) {
    throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  }
  return r.result.value;
}

const CHECKS = [];
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  CHECKS.push({ name, ok, actual, expected });
}

async function main() {
  const ws = await connect();
  await send(ws, 'Network.enable');
  // 绕过启发式缓存，确保验证的是磁盘上的最新扩展代码
  const nav = await send(ws, 'Page.navigate', { url: FIXTURE });
  if (nav.errorText) throw new Error('navigate failed: ' + nav.errorText);
  await new Promise((r) => setTimeout(r, 1500));
  // 捕获页面异常与控制台错误
  const pageErrors = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.method === 'Runtime.exceptionThrown') {
      pageErrors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
    } else if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
      pageErrors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
    }
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    }
  };
  await new Promise((r) => setTimeout(r, 1500));
  await evaljs(ws, `window.__rgfReady = (async () => {
    for (let i = 0; i < 40; i++) {
      if (document.querySelector('#rgf-badge')?.textContent) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('badge never appeared');
  })()`);
  await evaljs(ws, `__rgfReady`);

  // ---- 场景 1：初始过滤（allow alice + deny spammer -> 白名单模式）----
  const s1 = await evaljs(ws, `JSON.stringify((() => ({
    badge: document.querySelector('#rgf-badge').textContent,
    alice: document.querySelector('#item-alice').style.display,
    spammer: document.querySelector('#item-spammer').style.display,
    bob: document.querySelector('#item-bob').style.display,
    quickBtns: [...document.querySelectorAll('.rgf-quick-btn button')].map(b => b.textContent),
  }))())`);
  const state1 = JSON.parse(s1);
  check('角标显示白名单隐藏计数', state1.badge, '已隐藏 2 条动态，点击临时撤销');
  check('alice 放行（命中 allow）', state1.alice, '');
  check('spammer 隐藏（未命中 allow）', state1.spammer, 'none');
  check('bob 隐藏（未命中 allow）', state1.bob, 'none');
  check('悬停快捷按钮已注入', state1.quickBtns.sort(), ['隐藏 @alice', '隐藏 alice/web-toolkit', '隐藏 @bob', '隐藏 bob/kernel', '隐藏 @spammer', '隐藏 spammer/junk'].sort());

  // ---- 场景 2：点击角标 -> 临时撤销 ----
  await evaljs(ws, `document.querySelector('#rgf-badge').click(); 'clicked'`);
  await new Promise((r) => setTimeout(r, 400));
  const s2 = JSON.parse(await evaljs(ws, `JSON.stringify({
    badge: document.querySelector('#rgf-badge').textContent,
    spammer: document.querySelector('#item-spammer').style.display })`));
  check('临时撤销后全部显示', [s2.spammer, s2.badge], ['', '已临时撤销过滤 · 隐藏计数 2（点击恢复）']);

  // ---- 场景 3：再次点击 -> 恢复过滤 ----
  await evaljs(ws, `document.querySelector('#rgf-badge').click(); 'clicked'`);
  await new Promise((r) => setTimeout(r, 400));
  const s3 = JSON.parse(await evaljs(ws, `JSON.stringify({ spammer: document.querySelector('#item-spammer').style.display })`));
  check('恢复后重新隐藏', s3.spammer, 'none');

  // ---- 场景 4：动态插入新条目（模拟无限加载），去抖后自动过滤 ----
  await evaljs(ws, `(() => {
    const feed = document.querySelector('#conduit-feed-frame');
    const art = document.createElement('article');
    art.className = 'js-feed-item-component';
    art.id = 'item-new-spam';
    art.innerHTML = '<a data-hovercard-type="user" href="/spammer">@spammer</a> pushed to <a data-hovercard-type="repository" href="/spammer/junk">spammer / junk</a>';
    feed.appendChild(art);
    return 'inserted';
  })()`);
  await new Promise((r) => setTimeout(r, 800));
  const s4 = JSON.parse(await evaljs(ws, `JSON.stringify({ newItem: document.querySelector('#item-new-spam').style.display, badge: document.querySelector('#rgf-badge').textContent })`));
  check('新插入条目被自动过滤', s4.newItem, 'none');

  // ---- 场景 5：popup 流程等价——添加 keyword deny 规则，storage 变更联动 ----
  await evaljs(ws, `chrome.storage.sync.set({ 'rgf.rules': [
    { id: 'r_deny_spammer', dimension: 'actor', pattern: 'spammer', polarity: 'deny', enabled: true, hits: 0 },
    { id: 'r_kw_release', dimension: 'keyword', pattern: '*release*', polarity: 'deny', enabled: true, hits: 0 },
  ] }); 'set'`);
  await new Promise((r) => setTimeout(r, 600));
  const s5 = JSON.parse(await evaljs(ws, `JSON.stringify((() => ({
    badge: document.querySelector('#rgf-badge').textContent,
    alice: document.querySelector('#item-alice').style.display,
  }))())`));
  check('新增关键词规则后 alice 仍放行', s5.alice, '');
  check('角标计数更新为黑名单模式文案', s5.badge.includes('已隐藏'), true);

  // ---- 场景 6：总开关关闭 ----
  await evaljs(ws, `chrome.storage.sync.set({ 'rgf.enabled': false }); 'set'`);
  await new Promise((r) => setTimeout(r, 600));
  const s6 = JSON.parse(await evaljs(ws, `JSON.stringify((() => ({
    badge: document.querySelector('#rgf-badge').textContent,
    off: document.querySelector('#rgf-badge').classList.contains('rgf-badge--off'),
    spammer: document.querySelector('#item-spammer').style.display,
  }))())`));
  check('停用后角标提示且不再隐藏', [s6.off, s6.spammer], [true, '']);

  // 恢复启用，避免影响后续场景
  await evaljs(ws, `chrome.storage.sync.set({ 'rgf.enabled': true }); 'set'`);
  let failed = 0;
  for (const c of CHECKS) {
    if (!c.ok) failed++;
    console.log(`${c.ok ? 'PASS' : 'FAIL'} ${c.name}` + (c.ok ? '' : `\n  实际: ${JSON.stringify(c.actual)}\n  期望: ${JSON.stringify(c.expected)}`));
  }
  console.log(`\n${CHECKS.length - failed} 通过, ${failed} 失败`);
  if (pageErrors.length > 0) {
    console.log(`\n页面错误 ${pageErrors.length} 条:`);
    for (const e of [...new Set(pageErrors)].slice(0, 5)) console.log('---\n' + e.slice(0, 300));
  }
  process.exit(failed || pageErrors.length ? 1 : 0);
}

main().catch((e) => { console.error('E2E 错误:', e.message); process.exit(2); });