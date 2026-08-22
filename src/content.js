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
let rules = [];
let enabled = true;
let suspended = false; // 临时撤销：本页生效，刷新即失效
let loaded = false;    // 首次规则加载完成标志（panel.js 注入前依赖）

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
async function applyFilter() {
  const feed = findFeedContainer();
  if (!feed) return;

  const items = [...feed.querySelectorAll(ITEM_SELECTOR)];
  const parsed = items.map((el) => ({ el, item: extractItem(el) }));

  // 裁决始终照常计算（供计数与统计），是否真的隐藏由 suspended 决定
  const results = parsed.map(({ el, item }) => {
    const r = adjudicate(item, rules, enabled);
    return { el, item, hidden: r.hidden && !suspended, wouldHide: r.hidden, matched: r.matchedRules };
  });

  const hiddenCount = results.filter((r) => r.hidden).length;
  // 临时撤销期间展示"将被隐藏"的数量，让用户知道恢复后会滤掉什么
  const badgeCount = suspended
    ? results.filter((r) => r.wouldHide).length
    : hiddenCount;


  // 应用可见性 + 悬停快捷按钮；记录本轮隐藏集合用于命中统计去重
  const newlyHidden = new Set();
  for (const { el, item, hidden } of results) {
    const nextDisplay = hidden ? 'none' : '';
    if ((el.style.display === 'none') !== hidden) {
      if (hidden) {
        newlyHidden.add(item.actor || item.repo || item.text.slice(0, 40));
      }
    }
    el.style.setProperty('display', nextDisplay, 'important');
    attachQuickButtons(el);
  }

  // 命中统计：仅对"新隐藏"的去重条目计数，避免 MutationObserver 重渲染时重复累加
  if (newlyHidden.size > 0) {
    const hitDelta = {};
    for (const { item, hidden, matched } of results) {
      if (!hidden) continue;
      const key = item.actor || item.repo || item.text.slice(0, 40);
      if (!newlyHidden.has(key)) continue;
      for (const id of matched) {
        hitDelta[id] = (hitDelta[id] || 0) + 1;
      }
    }
    for (const rule of rules) {
      if (hitDelta[rule.id]) {
        rule.hits += hitDelta[rule.id];
        rule._dirtyHits = true;
      }
    }
    schedulePersistHits();
  }
  updateBadge(badgeCount);

}

// 命中统计节流写回 storage.sync
let persistTimer = null;
function schedulePersistHits() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(async () => {
    const hitMap = {};
    for (const rule of rules) {
      if (rule._dirtyHits) {
        hitMap[rule.id] = rule.hits;
        delete rule._dirtyHits;
      }
    }
    if (Object.keys(hitMap).length > 0) {
      const stored = await chrome.storage.sync.get(['rgf.ruleHits']);
      const merged = Object.assign({}, stored['rgf.ruleHits'] || {}, hitMap);
      chrome.storage.sync.set({ 'rgf.ruleHits': merged });
    }
  }, 2000);
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
  if (item.actor) {
    wrap.appendChild(makeQuickBtn(`隐藏 @${item.actor}`, () => addRule(DIMENSIONS.ACTOR, item.actor)));
  }
  if (item.repo) {
    wrap.appendChild(makeQuickBtn(`隐藏 ${item.repo}`, () => addRule(DIMENSIONS.REPO, item.repo)));
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

async function addRule(dimension, pattern) {
  const rule = makeRule({ dimension, pattern, polarity: POLARITY.DENY });
  rules.push(rule);
  await chrome.storage.sync.set({ [STORAGE_KEY]: rules });
  applyFilter();
}

// ---- 初始化与监听 ----
async function loadAndApply() {
  const stored = await chrome.storage.sync.get([STORAGE_KEY, STORAGE_ENABLED_KEY, 'rgf.ruleHits']);
  const merged = normalizeRules(stored[STORAGE_KEY]);
  const hits = stored['rgf.ruleHits'] || {};
  for (const rule of merged) {
    if (Number.isInteger(hits[rule.id])) {
      rule.hits = Math.max(rule.hits, hits[rule.id]);
    }
  }
  rules = merged;
  enabled = stored[STORAGE_ENABLED_KEY] !== false;
  loaded = true;
  applyFilter();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes[STORAGE_KEY]) {
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