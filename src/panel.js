// RefinedGithubFeeds - 原生筛选面板注入区块
'use strict';

const PANEL_MENU_ID = 'feed-filter-menu';
const BLOCK_CLASS = 'rgf-filter-block';

// ---- 草稿状态 ----
// 真实结构（登录态抓取）：
//   <details-menu class="SelectMenu-modal ... feed-filter-menu-body position-absolute">
//     <feed-filter data-target="feed-container.filter">
//       <div class="SelectMenu-header">…</div>
//       <div class="pt-2 overflow-auto">…原生分组… <hr> StarredRelationships 组 …</div>
//       <hr><div class="p-2 d-flex flex-justify-end">Reset/Save</div>
//     </feed-filter>
//   </details-menu>

// 幂等定位注入宿主；锚定最稳定的 Catalyst 元素 feed-filter，
// 不依赖外层标签名（真实结构为 details-menu 而非 details）与可漂移的 id
function findPanel() {
  const feedFilter = document.querySelector('feed-filter[data-target="feed-container.filter"]');
  if (!feedFilter) return null;
  // 注入宿主 = 可滚动内容区：原生分组、StarredRelationships 都在其内
  const host = feedFilter.querySelector('.pt-2.overflow-auto')
    || feedFilter.querySelector('[class*="overflow-auto"]');
  if (!host) return null;
  const saveBtn = feedFilter.querySelector('button[data-target="feed-filter.applyButton"]')
    || findButtonByText(feedFilter, 'save');
  const resetBtn = feedFilter.querySelector('button[data-action~="feed-filter#resetFilterToDefault"]')
    || findButtonByText(feedFilter, 'reset');
  return { host, saveBtn, resetBtn };
}

function findButtonByText(scope, keyword) {
  for (const btn of scope.querySelectorAll('button')) {
    if ((btn.textContent || '').trim().toLowerCase().includes(keyword)) return btn;
  }
  return null;
}

// ---- 区块 DOM 构建（复用 GitHub Primer 变量贴近原生风格）----
function buildBlock() {
  const block = document.createElement('div');
  // 与原生分组完全同一组标记：tmp-px-3（水平）+ mt-2（顶部）
  block.className = `${BLOCK_CLASS} tmp-px-3 mt-2`;


  return block;
}


// ---- 注入主流程：幂等 + 互斥，document 级观察器驱动重试（turbo 重渲染安全）----
let injecting = false; // async 注入进行中标志，防观察器并发双份注入
async function injectPanelBlock() {
  if (injecting) return;
  const panel = findPanel();
  if (!panel) return;
  injecting = true;
  try {
    await ensureLoaded();
    const { host, saveBtn, resetBtn } = panel;
    if (host.querySelector(':scope > .' + BLOCK_CLASS)) return;

    const block = buildBlock();
    buildSubFilters(block);

    // 挂钩原生 Save / Reset（捕获阶段先于 Catalyst 动作）；找不到 Save 则降级为即改即存
    if (saveBtn) {
      // 类型开关即时生效，原生 Save 仅承载 GitHub 自身偏好
    } else {
      console.warn('[RefinedGithubFeeds] 未找到原生 Save 按钮，注入区块改为即改即存');
      block.dataset.instantSave = 'true';
    }

    // 清理历史遗留/竞态产生的孤儿节点（宿主外的分隔符与区块）
    for (const orphan of document.querySelectorAll(
      `hr[data-rgf-sep]:not(${CSS.escape(host.localName)} hr[data-rgf-sep] *):not(${CSS.escape(host.localName)} > hr[data-rgf-sep])`,
    )) {
      if (!host.contains(orphan)) orphan.remove();
    }
    for (const orphan of document.querySelectorAll('.' + BLOCK_CLASS)) {
      if (!host.contains(orphan)) orphan.remove();
    }

    // 组间分隔 + 区块；注入前清理残留，保证任何重渲染路径下不堆积
    for (const stale of host.querySelectorAll(':scope > hr[data-rgf-sep]')) stale.remove();
    host.appendChild(buildSeparator());
    host.appendChild(block);
  } finally {
    injecting = false;
  }

}

function ensureLoaded() {
  if (loaded) return Promise.resolve();
  return loadAndApply();
}

// ---- 细粒度卡片类型过滤：按 card_type 精确排除，独立于规则与原生勾选 ----
const CARD_TYPE_DEFS = [
  ['STARRED_REPOSITORY', 'Star（仓库被 star）'],
  ['FORKED_REPOSITORY', 'Fork（仓库被 fork）'],
  ['MERGED_PULL_REQUEST', 'PR 合并'],
  ['RELEASE', 'Release 发布'],
  ['ADDED_TO_LIST', '加入 Star List'],
  ['REPOSITORY_RECOMMENDATION', '算法推荐'],
  ['TRENDING_REPOSITORY', '趋势榜'],
  ['PRIVATE_TO_PUBLIC_REPOSITORY', '私有转公开'],
];

const FOLLOWERS_KEY = 'rgf.followers';
const FOLLOWERS_AT_KEY = 'rgf.followersAt';
const SCOPE_KEY = 'rgf.scope';
const FOLLOWERS_TTL = 24 * 60 * 60 * 1000; // 24h

let scopeState = null;      // { onlyFollowers, onlyMyRepos } 草稿
let followersCache = [];    // 当前已缓存名单（用于显示数量）

async function buildSubFilters(block) {
  const stored = await chrome.storage.sync.get([SCOPE_KEY, FOLLOWERS_KEY, FOLLOWERS_AT_KEY]);
  scopeState = Object.assign({ onlyFollowers: false, onlyMyRepos: false }, stored[SCOPE_KEY]);
  followersCache = stored[FOLLOWERS_KEY] || [];
  const followersAt = stored[FOLLOWERS_AT_KEY] || 0;

  const section = document.createElement('div');
  section.className = 'rgf-subfilters';

  // ---- 发起者范围开关（扩展独有增强；切换立即重过滤）----
  const scopeBox = document.createElement('div');
  scopeBox.className = 'rgf-scope-box my-2';
  for (const [key, label, hint] of [
    ['onlyMyRepos', '只看我仓库的动态', '条目仓库属于当前账号'],
    ['onlyFollowers', `只看关注者的动态（${followersCache.length} 人）`, '发起者在你的关注者名单中'],
  ]) {
    const rowEl = document.createElement('label');
    rowEl.className = 'rgf-sub-row d-flex flex-items-center my-1 tmp-px-3 text-normal SelectMenu-item';
    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.checked = !!scopeState[key];
    chk.dataset.scope = key;
    chk.title = hint;
    chk.addEventListener('change', async () => {
      scopeState[key] = chk.checked;
      await chrome.storage.sync.set({ [SCOPE_KEY]: scopeState });
      applyFilter();
    });
    const lbl = document.createElement('span');
    lbl.className = 'ml-2';
    lbl.textContent = label;
    rowEl.append(chk, lbl);
    scopeBox.appendChild(rowEl);
  }
  // 关注者名单刷新行
  const refreshRow = document.createElement('div');
  refreshRow.className = 'small color-fg-muted tmp-px-3 pb-2 d-flex flex-items-center';
  const age = Date.now() - followersAt;
  const stale = !followersAt || age > FOLLOWERS_TTL;
  refreshRow.textContent = stale ? '关注者名单未缓存或已过期' : `关注者名单 ${Math.ceil(age / 3600000)} 小时前更新`;
  const refreshBtn = document.createElement('button');
  refreshBtn.type = 'button';
  refreshBtn.className = 'Button Button--invisible Button--small ml-auto rgf-refresh-btn';
  refreshBtn.textContent = '刷新名单';
  refreshBtn.addEventListener('click', async () => {
    refreshBtn.disabled = true;
    refreshBtn.textContent = '抓取中…';
    try {
      await fetchFollowers();
      loadAndApply();
    } catch (e) {
      refreshBtn.textContent = '抓取失败';
    }
    setTimeout(() => { refreshBtn.disabled = false; refreshBtn.textContent = '刷新名单'; }, 3000);
  });
  refreshRow.appendChild(refreshBtn);
  scopeBox.appendChild(refreshRow);
  section.appendChild(scopeBox);

  // ---- 细粒度卡片类型开关：直接驱动原生复选框（真正的原生增强）----
  // 每个开关映射到原生分组的一个 card_type 子集；切换时改写原生
  // checkbox 的 checked 并触发 feed-filter Catalyst 重载，
  // 使服务端偏好与前端状态保持一致。
  const groups = [
    ['社交动态', [
      ['STARRED_REPOSITORY', 'Star（仓库被 star）', 'Stars'],
      ['FORKED_REPOSITORY', 'Fork（仓库被 fork）', 'Repositories'],
    ]],
    ['仓库活动', [
      ['MERGED_PULL_REQUEST', 'PR 合并', 'RepositoryActivity'],
      ['RELEASE', 'Release 发布', 'Releases'],
      ['PRIVATE_TO_PUBLIC_REPOSITORY', '私有转公开', 'Repositories'],
    ]],
    ['发现内容', [
      ['ADDED_TO_LIST', '加入 Star List', 'Recommendations'],
      ['REPOSITORY_RECOMMENDATION', '算法推荐', 'Recommendations'],
      ['TRENDING_REPOSITORY', '趋势榜', 'Recommendations'],
    ]],
  ];
  const nativeInputs = () => {
    const map = {};
    for (const inp of document.querySelectorAll(
      '#feed-filter-menu input[data-targets="feed-filter.inputs"][name]')) {
      map[inp.name] = inp;
    }
    return map;
  };

  for (const [groupLabel, defs] of groups) {
    const gTitle = document.createElement('div');
    gTitle.className = 'rgf-group-title small text-bold color-fg-default tmp-px-3 mt-2';
    gTitle.textContent = groupLabel;
    section.appendChild(gTitle);
    for (const [type, label, nativeGroup] of defs) {
      const rowEl = document.createElement('label');
      rowEl.className = 'rgf-sub-row d-flex flex-items-center my-1 tmp-px-3 text-normal SelectMenu-item';
      const chk = document.createElement('input');
      chk.type = 'checkbox';
      // 初始态跟随原生分组勾选（同组内所有子类型共享父开关状态）
      const nInput = nativeInputs()[nativeGroup];
      chk.checked = nInput ? nInput.checked : true;
      chk.dataset.cardType = type;
      chk.dataset.nativeGroup = nativeGroup;
      chk.addEventListener('change', () => {
        // 驱动原生复选框：勾选=恢复该组显示，取消=隐藏整组
        const map = nativeInputs();
        const target = map[nativeGroup];
        if (target) {
          if (target.checked !== chk.checked) {
            target.checked = chk.checked;
            target.dispatchEvent(new Event('click', { bubbles: true }));
          }
        }
        applyFilter(); // 前端即时反馈
      });
      const lbl = document.createElement('span');
      lbl.className = 'ml-2';
      lbl.textContent = label;
      rowEl.append(chk, lbl);
      section.appendChild(rowEl);
    }
  }
  block.appendChild(section);
}

// 抓取关注者名单：解析 github.com/<user>?tab=followers 分页页面
async function fetchFollowers() {
  const me = currentUser();
  if (!me) throw new Error('未登录');
  const names = [];
  for (let page = 1; page <= 10; page++) {
    const res = await fetch(`https://github.com/${me}?tab=followers&page=${page}`, {
      credentials: 'same-origin',
    });
    if (!res.ok) break;
    const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
    const found = [...doc.querySelectorAll('[data-hovercard-type="user"], a.d-inline-block')
    ].map((a) => a.getAttribute('href')).filter((h) => h && /^\/[A-Za-z0-9-]+$/.test(h))
      .map((h) => h.slice(1));
    names.push(...found);
    // 无"下一页"则停止
    if (!doc.querySelector('.pagination a[rel="next"], a.next_page')) break;
    if (found.length === 0) break;
  }
  const unique = [...new Set(names)];
  await chrome.storage.sync.set({ [FOLLOWERS_KEY]: unique, [FOLLOWERS_AT_KEY]: Date.now() });
  return unique.length;
}

function buildSeparator() {
  const sep = document.createElement('hr');
  sep.className = 'mb-0 tmp-mx-3';   // 原生组间分隔的准确标记
  sep.dataset.rgfSep = 'true';
  return sep;
}

const panelObserver = new MutationObserver(() => injectPanelBlock());
panelObserver.observe(document.documentElement, { childList: true, subtree: true });
injectPanelBlock();