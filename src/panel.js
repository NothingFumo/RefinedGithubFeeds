// RefinedGithubFeeds - 原生筛选面板注入区块
'use strict';

const PANEL_MENU_ID = 'feed-filter-menu';
const BLOCK_CLASS = 'rgf-filter-block';

// ---- 草稿状态 ----
let draftRules = null; // 非 null 时表示有未提交草稿

// 真实结构（登录态抓取）：
//   <details id="feed-filter-menu"><summary>Filter</summary>
//     <feed-filter data-target="feed-container.filter">
//       <div class="SelectMenu-header">…</div>
//       <div class="pt-2 overflow-auto">…分组与复选框…</div>
//       <hr><div class="p-2 d-flex flex-justify-end">Reset/Save</div>
//     </feed-filter>
//   </details>

// 幂等定位面板与注入宿主；turbo 重渲染后由观察器驱动重试
function findPanel() {
  // 主定位：官方 id；回退：Catalyst 元素（部分布局/改版下 details id 可能缺失）
  const menu = document.getElementById(PANEL_MENU_ID)
    || document.querySelector('details:has(> summary [data-toggle-for="feed-filter-menu"])')
    || document.querySelector('feed-filter[data-target="feed-container.filter"]')?.closest('details');
  if (!menu) return null;
  // 注入宿主 = 可滚动内容区末尾：位于原生分组之后、底部按钮之上
  const host = menu.querySelector('feed-filter .pt-2.overflow-auto')
    || menu.querySelector('feed-filter')
    || menu;
  const saveBtn = menu.querySelector('button[data-target="feed-filter.applyButton"]')
    || findButtonByText(menu, 'save');
  const resetBtn = menu.querySelector('button[data-action~="feed-filter#resetFilterToDefault"]')
    || findButtonByText(menu, 'reset');
  return { menu, host, saveBtn, resetBtn };
}

function findButtonByText(scope, keyword) {
  for (const btn of scope.querySelectorAll('button')) {
    if ((btn.textContent || '').trim().toLowerCase().includes(keyword)) return btn;
  }
  return null;
}

// ---- 区块 DOM 构建（复用 GitHub Primer 变量贴近原生风格）----
const DIM_LABELS = { actor: '发起者', repo: '仓库', event: '事件', keyword: '关键词' };

function buildBlock() {
  const block = document.createElement('div');
  // 复用原生间距类：与 Events 分组标题同节奏（tmp-px-3 水平、mt-2 顶部）
  block.className = `${BLOCK_CLASS} tmp-px-3 mt-2`;

  const title = document.createElement('div');
  title.className = 'rgf-block-title';
  title.textContent = 'RefinedGithubFeeds';
  block.appendChild(title);

  const desc = document.createElement('div');
  desc.className = 'rgf-block-desc';
  desc.textContent = '按发起者 / 仓库 / 事件类型 / 关键词过滤动态流';
  block.appendChild(desc);

  const list = document.createElement('div');
  list.className = 'rgf-rule-list';
  block.appendChild(list);

  // 新增规则行
  const addRow = document.createElement('div');
  addRow.className = 'rgf-add-row';
  const dimSel = document.createElement('select');
  dimSel.className = 'rgf-input';
  dimSel.innerHTML = '<option value="actor">发起者</option><option value="repo">仓库</option><option value="event">事件类型</option><option value="keyword">关键词</option>';
  const patInput = document.createElement('input');
  patInput.type = 'text';
  patInput.className = 'rgf-input rgf-pattern';
  patInput.placeholder = '匹配值，支持 * 通配符';
  const polSel = document.createElement('select');
  polSel.className = 'rgf-input';
  polSel.innerHTML = '<option value="deny">隐藏命中</option><option value="allow">仅放行</option>';
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'rgf-btn rgf-btn-add';
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

  // 底部行：模式提示 + 管理页链接 + 草稿标记
  const footRow = document.createElement('div');
  footRow.className = 'rgf-foot-row';
  const modeHint = document.createElement('span');
  modeHint.className = 'rgf-mode-hint';
  footRow.appendChild(modeHint);
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
  const draftMark = document.createElement('span');
  draftMark.className = 'rgf-draft-mark';
  footRow.appendChild(draftMark);
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
    const rowEl = document.createElement('div');
    rowEl.className = 'rgf-rule-row';

    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.checked = rule.enabled;
    chk.title = rule.enabled ? '点击停用' : '点击启用';
    chk.addEventListener('change', () => {
      ensureDraft();
      const target = draftRules.find((r) => r.id === rule.id);
      if (target) target.enabled = chk.checked;
      renderRuleList(block);
      markDraftDirty(block);
    });

    const dimBadge = document.createElement('span');
    dimBadge.className = 'rgf-dim-badge';
    dimBadge.textContent = DIM_LABELS[rule.dimension] || rule.dimension;

    const polBadge = document.createElement('span');
    polBadge.className = 'rgf-pol-badge rgf-pol-' + rule.polarity;
    polBadge.textContent = rule.polarity === 'allow' ? '放行' : '隐藏';

    const patternSpan = document.createElement('span');
    patternSpan.className = 'rgf-pattern-text';
    patternSpan.textContent = rule.pattern;
    patternSpan.title = `命中 ${rule.hits || 0} 次`;

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'rgf-btn rgf-btn-del';
    delBtn.textContent = '×';
    delBtn.title = '删除规则';
    delBtn.addEventListener('click', () => {
      ensureDraft();
      const idx = draftRules.findIndex((r) => r.id === rule.id);
      if (idx >= 0) draftRules.splice(idx, 1);
      renderRuleList(block);
      markDraftDirty(block);
    });

    rowEl.append(chk, dimBadge, polBadge, patternSpan, delBtn);
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

// ---- 注入主流程：幂等，document 级观察器驱动重试（turbo 重渲染安全）----
async function injectPanelBlock() {
  const panel = findPanel();
  if (!panel) return;
  const { menu, host, saveBtn, resetBtn } = panel;
  if (!loaded) {
    await loadAndApply();
  }
  if (host.querySelector(':scope > .' + BLOCK_CLASS)) return;

  const block = buildBlock();

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

  // 组间分隔：与原生分组一致使用 hr；先清理残留再注入，防止重注入时堆积错位
  for (const stale of host.querySelectorAll(':scope > hr[data-rgf-sep]')) {
    stale.remove();
  }
  const sep = document.createElement('hr');
  sep.className = 'mb-0 tmp-mx-3';
  sep.dataset.rgfSep = 'true';
  host.appendChild(sep);
  host.appendChild(block);
  renderRuleList(block);
}

const panelObserver = new MutationObserver(() => injectPanelBlock());
panelObserver.observe(document.documentElement, { childList: true, subtree: true });
injectPanelBlock();