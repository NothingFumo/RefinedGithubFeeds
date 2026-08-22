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

  const title = document.createElement('h5');
  title.className = 'd-flex flex-items-center';
  title.textContent = 'RefinedGithubFeeds';
  block.appendChild(title);

  const desc = document.createElement('p');
  desc.className = 'small color-fg-muted mt-1';
  desc.textContent = '按卡片类型过滤动态流';
  block.appendChild(desc);

  return block;
}

function markDraftDirty(block) {
  const mark = block.querySelector('.rgf-draft-mark');
  if (mark) {
    mark.textContent = '未保存';
    mark.hidden = false;
  }
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
      saveBtn.addEventListener('click', () => { commitSubFilters(); }, true);
    } else {
      console.warn('[RefinedGithubFeeds] 未找到原生 Save 按钮，注入区块改为即改即存');
      block.dataset.instantSave = 'true';
    }
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        discardSubDraft();
        renderSubFilters(block);
      }, true);
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
const SUBFILTER_KEY = 'rgf.excludedTypes'; // 存储排除的 card_type 集合

let draftExcluded = null;   // 细粒度过滤草稿：与规则草稿同随原生 Save 提交
let subFilterBase = null;   // 已提交的排除集合基线
async function buildSubFilters(block) {
  const stored = await chrome.storage.sync.get([SUBFILTER_KEY]);
  subFilterBase = new Set(stored[SUBFILTER_KEY] || []);
  if (draftExcluded === null) draftExcluded = new Set(subFilterBase);

  const section = document.createElement('div');
  section.className = 'rgf-subfilters';
  const title = document.createElement('h5');
  title.className = 'd-flex flex-items-center';
  title.textContent = '更细过滤（按卡片类型）';
  section.appendChild(title);
  const desc = document.createElement('p');
  desc.className = 'small color-fg-muted mt-1';
  desc.textContent = '取消勾选即隐藏该类型，点 Save 生效';
  section.appendChild(desc);

  for (const [type, label] of CARD_TYPE_DEFS) {
    const rowEl = document.createElement('label');
    rowEl.className = 'rgf-sub-row d-flex flex-items-center my-1 tmp-px-3 text-normal SelectMenu-item';
    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.checked = !draftExcluded.has(type); // 勾选=显示
    chk.dataset.cardType = type;
    chk.addEventListener('change', () => {
      chk.checked ? draftExcluded.delete(type) : draftExcluded.add(type);
      markDraftDirty(block);
    });
    const lbl = document.createElement('span');
    lbl.className = 'ml-2';
    lbl.textContent = label;
    rowEl.append(chk, lbl);
    section.appendChild(rowEl);
  }
  block.appendChild(section);
}

function subFiltersChanged() {
  return draftExcluded !== null &&
    (draftExcluded.size !== subFilterBase.size ||
     [...draftExcluded].some((t) => !subFilterBase.has(t)));
}

async function commitSubFilters() {
  if (!subFiltersChanged()) {
    discardSubDraft();
    return false;
  }
  await chrome.storage.sync.set({ [SUBFILTER_KEY]: [...draftExcluded] });
  subFilterBase = new Set(draftExcluded);
  discardSubDraft();
  applyFilter();
  return true;
}

function discardSubDraft() {
  if (draftExcluded !== null) {
    draftExcluded = new Set(subFilterBase);
  }
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