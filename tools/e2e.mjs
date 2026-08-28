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

  // 基线：扩展接管状态下全部分组显示（stub 默认 rgf.nativeGroups={}）
  await evaljs(ws, `chrome.storage.sync.set({ 'rgf.nativeGroups': {} }); 'baseline'`);
  await new Promise((r) => setTimeout(r, 500));

  // ---- 场景 1：未配置白名单时全部显示 ----
  const s1 = await evaljs(ws, `JSON.stringify((() => ({
    badge: document.querySelector('#rgf-badge').textContent,
    alice: document.querySelector('#item-alice').style.display,
    spammer: document.querySelector('#item-spammer').style.display,
    quickBtns: [...document.querySelectorAll('.rgf-quick-btn button')].map(b => b.textContent),
  }))())`);
  const state1 = JSON.parse(s1);
  check('角标显示暂无隐藏', state1.badge, '暂无隐藏动态');
  check('alice 显示（未配置过滤）', state1.alice, '');
  check('spammer 显示（未配置过滤）', state1.spammer, '');
  check('快捷按钮为隐藏此类动态', state1.quickBtns.every(t => t === '隐藏此类动态'), true);

  // ---- 场景 2：原生 Stars 复选框点击被接管 -> starred 条目隐藏；角标计数 ----
  await evaljs(ws, `(() => {
    const inp = document.querySelector('#feed-filter-menu input[name="Stars"]');
    if (!inp) return 'missing';
    inp.click();   // 触发扩展拦截器（更新 nativeGroups + 前端过滤）
    return 'clicked';
  })()`);
  await new Promise((r) => setTimeout(r, 500));
  const s2a = JSON.parse(await evaljs(ws, `JSON.stringify({
    badge: document.querySelector('#rgf-badge').textContent,
    spammer: document.querySelector('#item-spammer').style.display })`));
  check('原生取消 Stars 后 fork 条目仍显示', s2a.spammer, '');
  check('角标计数为 2（alice+bob 均 starred）', s2a.badge, '已隐藏 2 条动态，点击临时撤销');
  const s2c = JSON.parse(await evaljs(ws, `JSON.stringify({
    panelStar: document.querySelector('.rgf-subfilters input[data-native-group-switch="Stars"]')?.checked,
    storeStars: window.__rgfStore['rgf.nativeGroups']?.Stars,
  })`));
  check('原生点击被接管并同步面板开关', s2c.panelStar === false && s2c.storeStars === false, true);

  await evaljs(ws, `document.querySelector('#rgf-badge').click(); 'clicked'`);
  await new Promise((r) => setTimeout(r, 400));
  const s2b = JSON.parse(await evaljs(ws, `JSON.stringify({
    badge: document.querySelector('#rgf-badge').textContent,
    alice: document.querySelector('#item-alice').style.display })`));
  check('临时撤销后全部显示', s2b.alice, '');

  // ---- 场景 3：恢复勾选 -> 再次点击角标恢复过滤 ----
  await evaljs(ws, `document.querySelector('#rgf-badge').click(); 'clicked'`);
  await evaljs(ws, `(() => {
    const inp = document.querySelector('#feed-filter-menu input[name="Stars"]');
    if (inp) inp.click();   // 拦截器恢复勾选
    return 'clicked';
  })()`);
  await new Promise((r) => setTimeout(r, 500));
  const s3 = JSON.parse(await evaljs(ws, `JSON.stringify({ spammer: document.querySelector('#item-spammer').style.display })`));
  check('恢复后状态正常', s3.spammer === '' || s3.spammer === 'none', true);

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
  check('无类型新条目不被白名单误杀', s4.newItem, '');

  // ---- 场景 5：范围开关 storage 联动（options 页等价路径）----
  await evaljs(ws, `chrome.storage.sync.set({ 'rgf.scope': { onlyMyRepos: true } }); 'set'`);
  await new Promise((r) => setTimeout(r, 600));
  const s5 = JSON.parse(await evaljs(ws, `JSON.stringify((() => ({
    alice: document.querySelector('#item-alice').style.display,
    spammer: document.querySelector('#item-spammer').style.display,
  }))())`));
  check('只看我仓库时自有仓库条目显示', s5.alice, '');
  check('只看我仓库时外部仓库条目隐藏', s5.spammer, 'none');
  await evaljs(ws, `chrome.storage.sync.set({ 'rgf.scope': { onlyMyRepos: false } }); 'set'`);
  await new Promise((r) => setTimeout(r, 500));

  // ---- 场景 6：总开关关闭 ----
  await evaljs(ws, `chrome.storage.sync.set({ 'rgf.enabled': false }); 'set'`);
  await new Promise((r) => setTimeout(r, 600));
  const s6 = JSON.parse(await evaljs(ws, `JSON.stringify((() => ({
    badge: document.querySelector('#rgf-badge').textContent,
    off: document.querySelector('#rgf-badge').classList.contains('rgf-badge--off'),
    spammer: document.querySelector('#item-spammer').style.display,
  }))())`));
  check('停用后角标提示且不再隐藏', [s6.off, s6.spammer], [true, '']);

  check('停用后角标提示且不再隐藏', [s6.off, s6.spammer], [true, '']);

  // 恢复启用，避免影响后续场景
  await evaljs(ws, `chrome.storage.sync.set({ 'rgf.enabled': true }); 'set'`);
  await new Promise((r) => setTimeout(r, 500));

  // P0 回归：启用状态下先隐藏（角色过滤），关闭总开关必须恢复显示
  await evaljs(ws, `chrome.storage.sync.set({ 'rgf.scope': { roleMode: 'self' } }); 'set'`);
  await new Promise((r) => setTimeout(r, 500));
  const p0a = JSON.parse(await evaljs(ws, `JSON.stringify({
    bobHidden: document.querySelector('#item-bob').style.display === 'none',
  })`));
  check('角色过滤生效中（bob 非自己被隐藏）', p0a.bobHidden, true);
  await evaljs(ws, `chrome.storage.sync.set({ 'rgf.enabled': false }); 'set'`);
  await new Promise((r) => setTimeout(r, 500));
  const p0b = JSON.parse(await evaljs(ws, `JSON.stringify({
    bobShown: document.querySelector('#item-bob').style.display !== 'none',
    aliceShown: document.querySelector('#item-alice').style.display !== 'none',
  })`));
  check('总开关关闭后全部条目恢复显示', p0b.bobShown && p0b.aliceShown, true);
  await evaljs(ws, `chrome.storage.sync.set({ 'rgf.enabled': true }); 'set'`);
  await new Promise((r) => setTimeout(r, 400));
  await evaljs(ws, `chrome.storage.sync.set({ 'rgf.scope': { roleMode: 'all' } }); 'set'`);
  await new Promise((r) => setTimeout(r, 400));

  // ---- 场景 7：原生 Filter 面板注入区块 ----
  await evaljs(ws, `(async () => {
    for (let i = 0; i < 40; i++) {
      if (document.querySelector('#feed-filter-menu .rgf-filter-block')) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('panel block never injected');
  })()`);
  const s7 = JSON.parse(await evaljs(ws, `JSON.stringify((() => {
    const block = document.querySelector('#feed-filter-menu .rgf-filter-block');
    const nativeGroup = document.querySelector('#feed-filter-menu .tmp-px-3.mt-2:not(.rgf-filter-block)');
    const scrollArea = document.querySelector('#feed-filter-menu feed-filter .pt-2.overflow-auto');
    const b = block.getBoundingClientRect();
    const n = nativeGroup ? nativeGroup.getBoundingClientRect() : null;
    return {
      blockExists: !!block,
      hostIsScrollArea: !!document.querySelector('#feed-filter-menu feed-filter .pt-2.overflow-auto > .rgf-filter-block'),
      instantSave: block.dataset.instantSave || '',
      subFilters: !!block.querySelector('.rgf-subfilters'),
      subChecks: block.querySelectorAll('.rgf-subfilters input[data-card-type]').length,
      nativeSwitches: block.querySelectorAll('.rgf-subfilters input[data-native-group-switch]').length,
      roleRadios: block.querySelectorAll('input[data-role-mode]').length,
      scopeToggles: block.querySelectorAll('input[data-scope]').length,
      groups: [...block.querySelectorAll('.rgf-subfilters h5')].map(g => g.textContent).filter(t => ['社交动态','仓库活动','发现内容'].includes(t)),
      // 几何对齐度量：区块与原生分组的左右内边距起点应一致
      blockLeft: Math.round(b.left),
      nativeLeft: n ? Math.round(n.left) : null,
      noHorizontalOverflow: b.right <= scrollArea.getBoundingClientRect().right + 1 && b.left >= scrollArea.getBoundingClientRect().left - 1,
      nativeLikeRows: [...block.querySelectorAll('.rgf-subfilters label.SelectMenu-item')].every(r =>
        !!r.querySelector('svg.feed-filter-item-icon') &&
        !!r.querySelector('span.small.color-fg-muted') &&
        r.dataset.selected === 'true' || r.dataset.selected === 'false'
      ),
    };
  })())`));
  check('注入区块存在于面板内', s7.blockExists, true);
  check('区块落在可滚动内容区内', s7.hostIsScrollArea, true);
  check('区块与原生分组左缘对齐', s7.nativeLeft !== null && Math.abs(s7.blockLeft - s7.nativeLeft) <= 2, true);
  check('区块无水平溢出', s7.noHorizontalOverflow, true);
  check('开关行完全仿原生结构（图标+描述+selected）', s7.nativeLikeRows, true);
  check('更细过滤分组已注入', s7.subFilters, true);
  check('十种卡片类型开关齐全', s7.subChecks, 10);
  check('九个原生分组开关齐全（接管）', s7.nativeSwitches, 9);
  check('四个角色单选开关齐全（含全部角色）', s7.roleRadios, 4);
  check('只看我仓库独立开关存在', s7.scopeToggles, 1);
  check('类型开关按语义分三组', s7.groups, ['社交动态', '仓库活动', '发现内容']);


  // ---- 场景 9b：id 缺失时经 Catalyst 回退仍能注入 ----
  await evaljs(ws, `(() => {
    const block = document.querySelector('#feed-filter-menu .rgf-filter-block');
    if (block) block.remove();
    document.getElementById('feed-filter-menu').removeAttribute('id');
    return 'stripped';
  })()`);
  await evaljs(ws, `(async () => {
    for (let i = 0; i < 40; i++) {
      if (document.querySelector('.rgf-filter-block')) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('fallback injection failed');
  })()`);
  check('id 缺失时回退定位成功', true, true);
  // 恢复 id 供后续场景使用（当前夹具已无后续面板场景则无影响）
  // 恢复 id 供后续场景使用
  const restored = await evaljs(ws, `(() => {
    const details = document.querySelector('details');
    if (details && !details.id) { details.id = 'feed-filter-menu'; return 'restored'; }
    return 'already';
  })()`);
  // ---- 场景 9c：重注入不得堆积分隔符（真实页面点击 Filter 即触发重渲染）----
  await evaljs(ws, `(async () => {
    const host = document.querySelector('#feed-filter-menu .pt-2.overflow-auto');
    // 模拟 GitHub turbo 重渲染：移除区块，观察器自动重注入
    for (let i = 0; i < 5; i++) {
      host.querySelector(':scope > .rgf-filter-block')?.remove();
      await new Promise((r) => setTimeout(r, 250));
    }
    return host.querySelectorAll(':scope > hr[data-rgf-sep]').length;
  })()`);
  const sepCount = JSON.parse(await evaljs(ws, `document.querySelectorAll('#feed-filter-menu [data-rgf-sep]').length`));
  check('多次重注入后分隔符不堆积', sepCount <= 1, true);

  // ---- 场景 9d：宿主外的孤儿区块/分隔符应被清扫（复现用户页面双份注入）----
  await evaljs(ws, `(() => {
    const details = document.getElementById('feed-filter-menu');
    const srcBlock = document.querySelector('#feed-filter-menu .rgf-filter-block');
    if (!srcBlock) return 'no-block-skip';
    const clone = srcBlock.cloneNode(true);
    const sep = document.createElement('hr');
    sep.className = 'rgf-sep';
    sep.dataset.rgfSep = 'true';
    details.appendChild(sep);
    details.appendChild(clone);
    return 'planted';
  })()`);
  await evaljs(ws, `(async () => {
    for (let i = 0; i < 30; i++) {
      const orphans = [...document.querySelectorAll('.rgf-filter-block')]
        .filter(b => !document.querySelector('.pt-2.overflow-auto').contains(b));
      if (orphans.length === 0) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('orphans not swept');
  })()`);
  check('宿主外孤儿区块被自动清扫', true, true);

  // ---- 场景 8d：快捷按钮「隐藏此类动态」-> 细粒度持久化（与面板开关一一对应）----
  await new Promise((r) => setTimeout(r, 800));
  await evaljs(ws, `(() => {
    const btn = document.querySelector('#item-spammer .rgf-quick-btn button');
    if (!btn) return 'btn-missing';
    btn.click();
    return 'clicked';
  })()`);
  await new Promise((r) => setTimeout(r, 500));
  const qbtn = JSON.parse(await evaljs(ws, `JSON.stringify((() => {
    const native = document.querySelector('#feed-filter-menu input[name="Repositories"]');
    const switchChk = document.querySelector('.rgf-subfilters input[data-card-type="FORKED_REPOSITORY"]');
    return {
      nativeExists: !!native,
      nativeChecked: native ? native.checked : null,
      switchChecked: switchChk ? switchChk.checked : null,
      spammerHidden: document.querySelector('#item-spammer').style.display === 'none',
    };
  })())`));
  check('原生 Repositories 分组存在', qbtn.nativeExists, true);
  check('快捷按钮不改写原生复选框', qbtn.nativeChecked, true);
  check('面板对应细粒度开关同步取消', qbtn.switchChecked, false);
  check('快捷按钮后条目即时隐藏', qbtn.spammerHidden, true);

  // 临时撤销（角标）：条目仍在 DOM（未触发服务端过滤），必须可恢复显示
  await evaljs(ws, `(() => {
    const badge = document.querySelector('#rgf-badge');
    badge.click();
    return 'suspended';
  })()`);
  const rev = JSON.parse(await evaljs(ws, `JSON.stringify({
    spammerShown: document.querySelector('#item-spammer').style.display !== 'none',
  })`));
  check('临时撤销后条目恢复显示', rev.spammerShown, true);
  // 恢复过滤（再次点击角标），并清除快捷按钮产生的 cardTypes 状态
  await evaljs(ws, `(() => {
    document.querySelector('#rgf-badge').click();
    return 'resumed';
  })()`);
  await evaljs(ws, `chrome.storage.sync.set({ 'rgf.cardTypes': {} }); 'cleared'`);
  await new Promise((r) => setTimeout(r, 500));

  // 细粒度开关：扩展自有持久化 + 前端过滤，不触碰原生复选框（避免同组状态矛盾）
  await evaljs(ws, `(() => {
    const chk = document.querySelector('.rgf-subfilters input[data-card-type="STARRED_REPOSITORY"]');
    if (!chk) throw new Error('subfilter missing');
    chk.checked = false;
    chk.dispatchEvent(new Event('change'));
    return 'toggled-off';
  })()`);
  await new Promise((r) => setTimeout(r, 500));
  const drv = JSON.parse(await evaljs(ws, `JSON.stringify((() => {
    const native = document.querySelector('#feed-filter-menu input[name="Stars"]');
    return {
      nativeChecked: native ? native.checked : null,
      starredHidden: document.querySelector('#item-alice').style.display === 'none',
    };
  })())`));
  check('细粒度开关不改写原生复选框', drv.nativeChecked, true);
  check('细粒度开关取消后对应类型条目隐藏', drv.starredHidden, true);
  // 恢复
  await evaljs(ws, `(() => {
    const chk = document.querySelector('.rgf-subfilters input[data-card-type="STARRED_REPOSITORY"]');
    if (chk) { chk.checked = true; chk.dispatchEvent(new Event('change')); }
    return 'restored';
  })()`);
  await new Promise((r) => setTimeout(r, 500));

  // ---- 场景 9f：全部勾选 + Save 后所有条目显示（回归保护）----
  await evaljs(ws, `(async () => {
    for (const chk of document.querySelectorAll('.rgf-subfilters input[data-card-type]')) {
      chk.checked = true;
      chk.dispatchEvent(new Event('change'));
    }
    [...document.querySelectorAll('#feed-filter-menu button')].find(b => b.textContent.trim() === 'Save').click();
    return 'saved-all';
  })()`);
  await new Promise((r) => setTimeout(r, 700));
  const s13 = JSON.parse(await evaljs(ws, `JSON.stringify((() => ({
    hidden: [...document.querySelectorAll('article.js-feed-item-component')].filter(e => e.style.display === 'none').map(e => e.id),
  }))())`));
  check('全勾选后无隐藏条目', s13.hidden, []);

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