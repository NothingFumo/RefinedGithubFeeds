// RefinedGithubFeeds - 原生筛选面板注入区块
'use strict';

const PANEL_MENU_ID = 'feed-filter-menu';
const BLOCK_CLASS = 'rgf-filter-block';

// ---- 草稿状态 ----
let draftRules = null; // 非 null 时表示有未提交草稿

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
const DIM_LABELS = { actor: '发起者', repo: '仓库', event: '事件类型', cardType: '卡片类型', keyword: '关键词' };

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
  desc.textContent = '按维度过滤动态流（支持 * 通配符）';
  block.appendChild(desc);

  // 规则列表：仿原生 SelectMenu-list 的复选框行
  const list = document.createElement('div');
  list.className = 'SelectMenu-list SelectMenu-list--borderless rgf-rule-list';
  list.setAttribute('role', 'menu');
  block.appendChild(list);

  // 新增规则行：与原生分组标题同构的紧凑表单
  const addRow = document.createElement('div');
  addRow.className = 'rgf-add-row tmp-px-3 my-2';
  const dimSel = document.createElement('select');
  dimSel.className = 'rgf-input SelectMenu-input';
  dimSel.innerHTML = '<option value="actor">发起者</option><option value="repo">仓库</option><option value="event">事件类型</option><option value="cardType">卡片类型</option><option value="keyword">关键词</option>';
  const patInput = document.createElement('input');
  patInput.type = 'text';
  patInput.className = 'rgf-input rgf-pattern SelectMenu-input';
  patInput.placeholder = '匹配值，如 torvalds/* 或 *release*';
  const polSel = document.createElement('select');
  polSel.className = 'rgf-input SelectMenu-input';
  polSel.title = '隐藏命中 = deny；仅放行命中 = allow（白名单模式）';
  polSel.innerHTML = '<option value="deny">隐藏</option><option value="allow">只看</option>';
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'Button Button--primary Button--small rgf-btn-add';
  addBtn.textContent = '添加';
  addBtn.addEventListener('click', () => {
    const rule = makeRule({ dimension: dimSel.value, pattern: patInput.value, polarity: polSel.value });
    const err = validateRule(rule);
    if (err) {
      markDraftError(err);
      return;
    }
    ensureDraft();
    draftRules.push(rule);
    renderRuleList(block);
    patInput.value = '';
    markDraftDirty(block);
  });
  addRow.append(dimSel, patInput, polSel, addBtn);
  block.appendChild(addRow);

  // 底部行：模式提示 + 草稿标记 + 管理页链接
  const footRow = document.createElement('div');
  footRow.className = 'rgf-foot-row small color-fg-muted';
  const modeHint = document.createElement('span');
  modeHint.className = 'rgf-mode-hint';
  footRow.appendChild(modeHint);
  const draftMark = document.createElement('span');
  draftMark.className = 'rgf-draft-mark';
  draftMark.hidden = true;
  footRow.appendChild(draftMark);
  const spacer = document.createElement('span');
  spacer.className = 'rgf-foot-spacer';
  footRow.appendChild(spacer);
  const manageLink = document.createElement('a');
  manageLink.href = '#';
  manageLink.className = 'rgf-manage-link';
  manageLink.textContent = '管理全部规则 →';
  manageLink.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
  footRow.appendChild(manageLink);
  block.appendChild(footRow);

  return block;
}

function ensureDraft() {
  if (draftRules === null) {
    draftRules = deepClone(rules);
  }
}

function rulesChanged() {
  return JSON.stringify(draftRules) !== JSON.stringify(rules);
}

function markDraftDirty(block) {
  const mark = block.querySelector('.rgf-draft-mark');
  if (mark) {
    mark.textContent = '未保存';
    mark.hidden = false;
  }
}

function markDraftError(message) {
  const block = document.querySelector('.' + BLOCK_CLASS);
  if (!block) return;
  const mark = block.querySelector('.rgf-draft-mark');
  if (mark) {
    mark.textContent = message;
    mark.hidden = false;
    setTimeout(() => {
      mark.textContent = draftRules && rulesChanged() ? '未保存' : '';
    }, 2500);
  }
}

// 渲染草稿规则列表：启用勾选、维度/极性徽标、匹配值、删除
function renderRuleList(block) {
  const list = block.querySelector('.rgf-rule-list');
  list.textContent = '';
  const source = draftRules || rules;
  updateModeHint(block.querySelector('.rgf-mode-hint'), source);
  // 区块重建后草稿可能仍存活：与已存规则不一致时恢复"未保存"提示
  const mark = block.querySelector('.rgf-draft-mark');
  if (mark) {
    const dirty = draftRules !== null && rulesChanged();
    mark.hidden = !dirty;
    if (dirty) mark.textContent = '未保存';
  }
  for (const rule of source) {
    // 仿原生条目标记：label.SelectMenu-item + 复选框 + 标题 + 描述
    const rowEl = document.createElement('label');
    rowEl.className = 'rgf-rule-row d-flex pl-0 my-2 tmp-px-3 flex-column flex-items-start text-normal SelectMenu-item js-navigation-item';
    if (!rule.enabled) rowEl.style.opacity = '0.55';

    const headWrap = document.createElement('div');
    headWrap.className = 'd-flex flex-items-center width-full';

    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.checked = rule.enabled;
    chk.title = rule.enabled ? '点击停用' : '点击启用';
    chk.addEventListener('click', (e) => e.stopPropagation());
    chk.addEventListener('change', () => {
      ensureDraft();
      const target = draftRules.find((r) => r.id === rule.id);
      if (target) target.enabled = chk.checked;
      renderRuleList(block);
      markDraftDirty(block);
    });

    const polBadge = document.createElement('span');
    polBadge.className = 'rgf-pol-badge rgf-pol-' + rule.polarity;
    polBadge.textContent = rule.polarity === 'allow' ? '只看' : '隐藏';

    const titleEl = document.createElement('h5');
    titleEl.className = 'd-flex flex-items-center ml-2 mb-0';
    // 与原生分组同款：标题行 = 维度 · 匹配值
    titleEl.textContent = `${DIM_LABELS[rule.dimension] || rule.dimension}：${rule.pattern}`;

    headWrap.append(chk, polBadge, titleEl);

    const descWrap = document.createElement('div');
    descWrap.className = 'd-flex flex-column width-full';
    const descSpan = document.createElement('span');
    descSpan.className = 'small color-fg-muted mt-1';
    descSpan.style.marginLeft = '21px';
    const hits = rule.hits || 0;
    descSpan.textContent = hits > 0 ? `已命中 ${hits} 次` : '尚未命中';
    descWrap.appendChild(descSpan);

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'Button Button--invisible Button--small rgf-btn-del ml-auto';
    delBtn.textContent = '删除';
    delBtn.title = '从草稿中移除此规则';
    delBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      ensureDraft();
      const idx = draftRules.findIndex((r) => r.id === rule.id);
      if (idx >= 0) draftRules.splice(idx, 1);
      renderRuleList(block);
      markDraftDirty(block);
    });

    rowEl.append(headWrap, descWrap, delBtn);
    list.appendChild(rowEl);
  }
  if (source.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'rgf-empty';
    empty.textContent = '暂无规则，用上方表单添加';
    list.appendChild(empty);
  }
}

function updateModeHint(hintEl, sourceRules) {
  if (!hintEl) return;
  const active = sourceRules.filter((r) => r.enabled);
  const hasAllow = active.some((r) => r.polarity === 'allow');
  hintEl.textContent = !active.length ? '无启用规则'
    : hasAllow ? '白名单模式' : `${active.length} 条隐藏规则`;
}

// ---- 提交与还原 ----
async function commitDraft() {
  if (draftRules === null || !rulesChanged()) {
    discardDraft();
    return false;
  }
  rules = normalizeRules(draftRules);
  await chrome.storage.sync.set({ [STORAGE_KEY]: rules });
  discardDraft();
  applyFilter();
  return true;
}

function discardDraft() {
  draftRules = null;
  const block = document.querySelector('.' + BLOCK_CLASS);
  if (block) {
    const mark = block.querySelector('.rgf-draft-mark');
    if (mark) mark.hidden = true;
    renderRuleList(block);
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
      saveBtn.addEventListener('click', () => { commitDraft(); }, true);
    } else {
      console.warn('[RefinedGithubFeeds] 未找到原生 Save 按钮，注入区块改为即改即存');
      block.dataset.instantSave = 'true';
    }
    if (resetBtn) {
      resetBtn.addEventListener('click', () => { discardDraft(); }, true);
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
    renderRuleList(block);
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

async function buildSubFilters(block) {
  const stored = await chrome.storage.sync.get([SUBFILTER_KEY]);
  const excluded = new Set(stored[SUBFILTER_KEY] || []);

  const section = document.createElement('div');
  section.className = 'rgf-subfilters';
  const title = document.createElement('h5');
  title.className = 'd-flex flex-items-center';
  title.textContent = '更细过滤（按卡片类型）';
  section.appendChild(title);
  const desc = document.createElement('p');
  desc.className = 'small color-fg-muted mt-1';
  desc.textContent = '取消勾选即从首页隐藏该类型，立即生效，无需 Save';
  section.appendChild(desc);

  for (const [type, label] of CARD_TYPE_DEFS) {
    const rowEl = document.createElement('label');
    rowEl.className = 'rgf-sub-row d-flex flex-items-center my-1 tmp-px-3 text-normal SelectMenu-item';
    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.checked = !excluded.has(type); // 勾选=显示
    chk.dataset.cardType = type;
    chk.addEventListener('change', async () => {
      const cur = await chrome.storage.sync.get([SUBFILTER_KEY]);
      const set = new Set(cur[SUBFILTER_KEY] || []);
      chk.checked ? set.delete(type) : set.add(type);
      await chrome.storage.sync.set({ [SUBFILTER_KEY]: [...set] });
      applyFilter();
    });
    const lbl = document.createElement('span');
    lbl.className = 'ml-2';
    lbl.textContent = label;
    rowEl.append(chk, lbl);
    section.appendChild(rowEl);
  }
  block.appendChild(section);
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