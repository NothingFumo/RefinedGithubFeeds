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

// 原生筛选面板勾选状态 -> 卡片类型过滤。未勾选的类型一律隐藏。
// data-name 与 feed_card.card_type 的映射（用户页面 2.5MB 实抓校准）：
const NATIVE_TYPE_MAP = {
  Releases: 'RELEASE',
  Sponsors: null,            // 无独立 card_type，无法精确判定则不过滤
  Stars: 'STARRED_REPOSITORY',
  Repositories: 'FORKED_REPOSITORY,PRIVATE_TO_PUBLIC_REPOSITORY',
  RepositoryActivity: 'MERGED_PULL_REQUEST,PULL_REQUEST',
  Recommendations: 'REPOSITORY_RECOMMENDATION,TRENDING_REPOSITORY,ADDED_TO_LIST',
};


// 发起者范围开关：rgf.scope = { onlyFollowers: bool, onlyMyRepos: bool }
let scopeFilter = { onlyFollowers: false, onlyMyRepos: false };
// 关注者名单缓存（panel.js 抓取写入 rgf.followers + rgf.followersAt）
let followersSet = null;

function readNativeSelection() {
  const checked = new Set();
  const unchecked = new Set();
  for (const input of document.querySelectorAll(
    '#feed-filter-menu input[data-targets="feed-filter.inputs"][name]')) {
    (input.checked ? checked : unchecked).add(input.name);
  }
  return { checked, unchecked };
}

// 条目是否被排除：原生未勾选分组 / 发起者范围（无全局白名单层）
function isExcluded(item, unchecked) {
  if (unchecked.size > 0 && item.cardType) {
    for (const name of unchecked) {
      const types = NATIVE_TYPE_MAP[name];
      if (!types) continue;
      if (types.split(',').includes(item.cardType)) return true;
    }
  }
  // 发起者范围：仅当条目有 actor 时可判定；无 actor 的推荐/趋势不受影响
  if ((scopeFilter.onlyFollowers || scopeFilter.onlyMyRepos) && item.actor) {
    if (scopeFilter.onlyFollowers &&
        followersSet && !followersSet.has(item.actor.toLowerCase())) return true;
    if (scopeFilter.onlyMyRepos && item.repo) {
      const me = currentUser();
      if (me && !item.repo.toLowerCase().startsWith(me.toLowerCase() + '/')) return true;
    }
  }
  return false;
}

async function applyFilter() {
  const feed = findFeedContainer();
  if (!feed) return;

  const items = [...feed.querySelectorAll(ITEM_SELECTOR)];
  const { unchecked } = readNativeSelection();
  const parsed = items.map((el) => ({ el, item: extractItem(el) }));

  // 裁决 = 原生勾选联动 + 细粒度类型白名单 + 发起者范围
  //（三者不受 suspended 影响：它们是用户明确的类型偏好）
  // wouldHide 始终按"未撤销"计算（供角标展示恢复后将被滤掉的数量）
  const results = parsed.map(({ el, item }) => {
    const excluded = isExcluded(item, unchecked);
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
  // 快捷操作：隐藏该卡片类型（从白名单移除），与面板更细过滤联动
  if (item.cardType && CARD_TYPE_TO_NATIVE[item.cardType]) {
    const nativeGroup = CARD_TYPE_TO_NATIVE[item.cardType];
    wrap.appendChild(makeQuickBtn(t('hideThisType'), () => {
      // 联动原生面板：取消勾选该类型所在的原生分组复选框，
      // 面板开关状态与过滤行为同步（原生增强语义）
      const target = document.querySelector(
        `#feed-filter-menu input[data-targets="feed-filter.inputs"][name="${nativeGroup}"]`);
      if (target) {
        target.checked = false;
        applyFilter(); // 前端即时隐藏
      }
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
    STORAGE_ENABLED_KEY, 'rgf.scope', 'rgf.followers',
  ]);
  enabled = stored[STORAGE_ENABLED_KEY] !== false;
  scopeFilter = Object.assign({ onlyFollowers: false, onlyMyRepos: false }, stored['rgf.scope']);
  followersSet = new Set((stored['rgf.followers'] || []).map((u) => u.toLowerCase()));
  loaded = true;
  applyFilter();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && (changes['rgf.scope'] || changes['rgf.followers'])) {
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