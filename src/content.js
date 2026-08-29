// RefinedGithubFeeds - 内容脚本：注入过滤、角标、快捷按钮
'use strict';

const FEED_CONTAINER_SELECTORS = [
  '#conduit-feed-frame',
  'feed-container',
  '.js-for-you-feed-items',
];
const ITEM_SELECTOR = 'article.js-feed-item-component';
const BADGE_ID = 'rgf-badge';
const BTN_CLASS = 'rgf-quick-btn';

// ---- 状态 ----
let enabled = true;
let suspended = false; // 临时撤销：本页生效，刷新即失效
let loaded = false;    // 首次配置加载完成标志（panel.js 注入前依赖）

function findFeedContainer() {
  for (const sel of FEED_CONTAINER_SELECTORS) {
    const el = document.querySelector(sel);
    if (el) return el;
  }
  return null;
}

function getBadge() {
  let badge = document.getElementById(BADGE_ID);
  if (!badge) {
    badge = document.createElement('div');
    badge.id = BADGE_ID;
    badge.className = 'rgf-badge';
    const feed = findFeedContainer();
    if (feed && feed.parentElement) {
      feed.parentElement.insertBefore(badge, feed);
    } else {
      document.querySelector('main')?.prepend(badge);
    }
  }
  return badge;
}

function updateBadge(hiddenCount) {
  const badge = getBadge();
  const text = !enabled
    ? 'RefinedGithubFeeds 已停用（点击启用）'
    : suspended
      ? `已临时撤销过滤 · 隐藏计数 ${hiddenCount}（点击恢复）`
      : hiddenCount > 0 ? `已隐藏 ${hiddenCount} 条动态，点击临时撤销` : '暂无隐藏动态';
  // 文本未变化时不写 DOM，避免触发自身 MutationObserver 造成死循环
  if (badge.textContent === text) return;
  badge.textContent = text;
  badge.classList.toggle('rgf-badge--off', !enabled);
}

// ---- 过滤主流程 ----

// 角色范围：rgf.scope = { roleMode: 'all'|'self'|'orgs'|'users', onlyMyRepos: bool }
let scopeFilter = { roleMode: 'all', onlyMyRepos: false };
// 扩展自有类型偏好：rgf.cardTypes = { CARD_TYPE: bool }；null=未配置则全部显示
let cardTypes = null;
// 原生分组接管状态：rgf.nativeGroups = { GROUP: bool }；null/缺省=全部显示
// 扩展是唯一过滤状态源；原生复选框仅作视觉镜像并被拦截
let nativeGroups = null;

// 条目是否被排除：扩展状态（原生分组接管 + 类型偏好）+ 角色范围
function isExcluded(item) {
  // 原生分组接管：未勾选的分组 -> 组内全部 card_type 隐藏
  if (nativeGroups && item.cardType) {
    for (const name of NATIVE_GROUPS) {
      if (nativeGroups[name] === false) {
        const types = NATIVE_TYPE_MAP[name];
        if (types && types.split(',').includes(item.cardType)) return true;
      }
    }
  }
  // 扩展自有类型偏好：未勾选的 card_type 前端隐藏
  if (cardTypes && item.cardType && cardTypes[item.cardType] === false) return true;
  // 角色范围：仅当条目有 actor 时可判定；无 actor 的推荐/趋势不受影响
  const roleMode = scopeFilter.roleMode || 'all';
  if (roleMode !== 'all' && item.actor) {
    const me = currentUser();
    const actorLower = item.actor.toLowerCase();
    const isSelf = !!me && actorLower === me.toLowerCase();
    const isOrg = !!item.actorEl && item.actorEl.getAttribute('data-hovercard-type') === 'organization';
    if (roleMode === 'self' && !isSelf) return true;
    if (roleMode === 'orgs' && !isOrg) return true;
    if (roleMode === 'users' && (isSelf || isOrg)) return true;
  }
  if (scopeFilter.onlyMyRepos && item.repo) {
    const me = currentUser();
    if (me && !item.repo.toLowerCase().startsWith(me.toLowerCase() + '/')) return true;
  }
  return false;
}

async function applyFilter() {
  const feed = findFeedContainer();
  if (!feed) return;

  // 总开关关闭：恢复全部显示（服务端偏好与快捷按钮联动不受影响）
  if (!enabled) {
    for (const el of feed.querySelectorAll(ITEM_SELECTOR)) {
      el.style.removeProperty('display');
    }
    updateBadge(0);
    return;
  }

  const items = [...feed.querySelectorAll(ITEM_SELECTOR)];
  const parsed = items.map((el) => ({ el, item: extractItem(el) }));

  // 裁决 = 扩展状态（原生分组接管 + 类型偏好 + 角色范围），单一状态源
  // wouldHide 始终按"未撤销"计算（供角标展示恢复后将被滤掉的数量）
  const results = parsed.map(({ el, item }) => {
    const excluded = isExcluded(item);
    return { el, item, hidden: excluded && !suspended, wouldHide: excluded };
  });

  const hiddenCount = results.filter((r) => r.hidden).length;
  // 临时撤销期间展示"将被隐藏"的数量，让用户知道恢复后会滤掉什么
  const badgeCount = suspended
    ? results.filter((r) => r.wouldHide).length
    : hiddenCount;

  // 应用可见性 + 悬停快捷按钮
  for (const { el, item, hidden } of results) {
    el.style.setProperty('display', hidden ? 'none' : '', 'important');
    attachQuickButtons(el);
  }
  syncNativeCheckboxes();
  updateBadge(badgeCount);
}

// ---- 悬停快捷按钮 ----
let styleInjected = false;
function ensureButtonStyle() {
  if (styleInjected) return;
  styleInjected = true;
  const css = `
.${BTN_CLASS} {
  position: absolute; top: 8px; right: 8px; display: none; gap: 4px; z-index: 30;
}
${ITEM_SELECTOR}:hover .${BTN_CLASS} { display: flex; }
.${BTN_CLASS} button {
  font-size: 11px; padding: 2px 6px; border-radius: 6px; cursor: pointer;
  border: 1px solid var(--color-border-default, #d1d9e0);
  background: var(--color-canvas-subtle, #f6f8fa);
  color: var(--color-fg-muted, #59636e);
}
.${BTN_CLASS} button:hover { color: var(--color-accent-fg, #0969da); border-color: currentColor; }
`;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
}

function attachQuickButtons(el) {
  ensureButtonStyle();
  if (el.querySelector(':scope > .' + BTN_CLASS)) return;
  el.style.position = 'relative';
  const wrap = document.createElement('div');
  wrap.className = BTN_CLASS;
  const item = extractItem(el);
  // 快捷操作：隐藏该卡片类型 —— 与面板细粒度开关同一持久化（rgf.cardTypes）
  // 不触碰原生分组复选框（避免触发服务端过滤导致条目从 DOM 移除，
  // 临时撤销角标无法恢复）；条目保留在 DOM，前端 display 控制
  if (item.cardType) {
    wrap.appendChild(makeQuickBtn('隐藏此类动态', async () => {
      const next = Object.assign({}, cardTypes || {});
      next[item.cardType] = false;
      cardTypes = next;
      await chrome.storage.sync.set({ 'rgf.cardTypes': next });
      applyFilter();
    }));
  }
  if (wrap.children.length > 0) {
    el.prepend(wrap);
  }
}

function makeQuickBtn(label, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = label;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    onClick();
  });
  return btn;
}

// ---- 初始化与监听 ----
async function loadAndApply() {
  const stored = await chrome.storage.sync.get([
    STORAGE_ENABLED_KEY, 'rgf.scope', 'rgf.cardTypes', 'rgf.nativeGroups',
  ]);
  enabled = stored[STORAGE_ENABLED_KEY] !== false;
  scopeFilter = Object.assign({ roleMode: 'all', onlyMyRepos: false }, stored['rgf.scope']);
  cardTypes = stored['rgf.cardTypes'] || null;
  nativeGroups = stored['rgf.nativeGroups'] || null;
  loaded = true;
  applyFilter();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && (changes['rgf.scope'] || changes['rgf.cardTypes'] || changes['rgf.nativeGroups'])) {
    loadAndApply();
  } else if (area === 'sync' && changes[STORAGE_ENABLED_KEY]) {
    loadAndApply();
  }
});

getBadge().addEventListener('click', () => {
  if (!enabled) {
    chrome.storage.sync.set({ [STORAGE_ENABLED_KEY]: true });
    return;
  }
  suspended = !suspended;
  applyFilter();
});

// ---- 接管原生 Filter 面板 ----
// 原生复选框降级为扩展状态的视觉镜像；点击被拦截并改写扩展状态
// （阻止 Catalyst 提交服务端偏好，避免条目被服务端移除导致临时撤销失效）
function syncNativeCheckboxes() {
  const filter = document.querySelector('feed-filter[data-target="feed-container.filter"]');
  if (!filter) return;
  for (const inp of filter.querySelectorAll('input[data-targets="feed-filter.inputs"][name]')) {
    const wanted = nativeGroups ? nativeGroups[inp.name] !== false : true;
    if (inp.checked !== wanted) inp.checked = wanted;
  }
}

function toggleNativeGroup(name) {
  const next = Object.assign({}, nativeGroups || {});
  next[name] = next[name] === false ? true : false;
  nativeGroups = next;
  chrome.storage.sync.set({ 'rgf.nativeGroups': next });
  applyFilter();
}

function closeFilterMenu() {
  const menu = document.getElementById('feed-filter-menu');
  if (menu) menu.removeAttribute('open');
}

function hijackNativePanel() {
  const filter = document.querySelector('feed-filter[data-target="feed-container.filter"]');
  if (!filter || filter.dataset.rgfHijacked) return;
  filter.dataset.rgfHijacked = 'true';
  filter.addEventListener('click', (e) => {
    // 复选框：拦截并改写扩展状态
    const input = e.target.closest('input[data-targets="feed-filter.inputs"][name]');
    if (input) {
      e.preventDefault();
      e.stopPropagation();
      // 基于扩展状态翻转（不读 DOM checked：checkbox 默认动作时序会先翻转它）
      toggleNativeGroup(input.name);
      return;
    }
    // 整行 label（原生行是 label，点击文本区域是主交互）：同样接管
    const row = e.target.closest('label[data-action*="feed-filter#handleToggle"]');
    if (row) {
      e.preventDefault();
      e.stopPropagation();
      const name = row.dataset.name;
      if (name) toggleNativeGroup(name);
      return;
    }
    const btn = e.target.closest('button');
    if (btn) {
      e.preventDefault();
      e.stopPropagation();
      // Save：扩展状态即时生效（开关操作已写 storage），仅关闭菜单作为保存反馈
      // Reset：恢复全部分组
      if (btn.matches('[data-action*="resetFilterToDefault"]') || /reset/i.test(btn.textContent)) {
        nativeGroups = {};
        chrome.storage.sync.set({ 'rgf.nativeGroups': {} });
        applyFilter();
      }
      closeFilterMenu();
    }
  });
}

// 面板可能晚于页面加载出现（用户打开 Filter 才挂载），观察器兜底
const nativePanelObserver = new MutationObserver(() => {
  hijackNativePanel();
  syncNativeCheckboxes();
});
nativePanelObserver.observe(document.body, { childList: true, subtree: true });
hijackNativePanel();

// 去抖：GitHub 渲染与自身 DOM 写入会触发高频 mutation，合并为一次重过滤
let filterTimer = null;
function scheduleApplyFilter() {
  clearTimeout(filterTimer);
  filterTimer = setTimeout(applyFilter, 100);
}

const observer = new MutationObserver((muts) => {
  // 忽略完全来自自身标记节点（角标/快捷按钮容器）的变更
  const own = muts.every((m) =>
    m.target.closest?.('#' + BADGE_ID + ', .' + BTN_CLASS));
  if (own) return;
  scheduleApplyFilter();
});
observer.observe(document.body, { childList: true, subtree: true });

loadAndApply();