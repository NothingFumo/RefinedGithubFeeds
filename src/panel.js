// RefinedGithubFeeds - 原生筛选面板注入区块
'use strict';

const PANEL_MENU_ID = 'feed-filter-menu';
const BLOCK_CLASS = 'rgf-filter-block';

// 模块级状态（由 buildSubFilters 填充；loaded 由 content.js 声明共享）
let scopeState = null;      // { roleMode, onlyMyRepos }

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

// 存储键：角色范围（与 content.js 共享）
const SCOPE_KEY = 'rgf.scope';
const CARD_TYPES_KEY = 'rgf.cardTypes';

// 完全仿原生面板行：结构与原生 SelectMenu-item 逐字节同构
// （图标 + 标题 + 描述；不挂 data-action 以免被原生 Catalyst 控制器接管）
function makeNativeRow({ name, iconKey, checked, label, desc, input }) {
  const rowEl = document.createElement('label');
  rowEl.className = 'd-flex pl-0 my-2 tmp-px-3 flex-column flex-items-start text-normal SelectMenu-item js-navigation-item';
  rowEl.dataset.selected = checked ? 'true' : 'false';
  rowEl.dataset.name = name;
  const head = document.createElement('div');
  head.className = 'd-flex flex-items-center';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('data-component', 'Octicon');
  svg.setAttribute('height', '16');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', '16');
  svg.setAttribute('data-view-component', 'true');
  svg.setAttribute('class', 'octicon octicon-' + iconKey + ' feed-filter-item-icon color-fg-muted mx-2 tmp-mx-2');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', OCTICON_PATHS[iconKey] || OCTICON_PATHS.person);
  svg.appendChild(path);
  const h5 = document.createElement('h5');
  h5.className = 'd-flex flex-items-center';
  h5.textContent = label;
  head.append(input, svg, h5);
  const descWrap = document.createElement('div');
  descWrap.className = 'd-flex flex-column';
  const span = document.createElement('span');
  span.className = 'small color-fg-muted mt-1';
  span.style.marginLeft = '21px';
  span.textContent = desc;
  descWrap.appendChild(span);
  rowEl.append(head, descWrap);
  return rowEl;
}

// 原生分组元数据：图标 + 描述文案（与原生面板一致）
const NATIVE_GROUP_META = {
  Announcements: { icon: 'megaphone', desc: '来自仓库的特殊讨论帖' },
  Releases: { icon: 'tag', desc: '来自仓库的更新帖' },
  Sponsors: { icon: 'heart', desc: '正在被赞助的相关项目或人物' },
  Stars: { icon: 'star', desc: '人们正在 star 的仓库' },
  Repositories: { icon: 'repo', desc: '人们创建或 fork 的仓库' },
  RepositoryActivity: { icon: 'repo', desc: '来自仓库的 Issue 与拉取请求' },
  Follows: { icon: 'personAdd', desc: '人们正在关注谁' },
  Recommendations: { icon: 'markGithub', desc: '你可能喜欢的仓库与人物' },
};

async function buildSubFilters(block) {
  const stored = await chrome.storage.sync.get([SCOPE_KEY, CARD_TYPES_KEY]);
  scopeState = Object.assign({ roleMode: 'all', onlyMyRepos: false }, stored[SCOPE_KEY]);
  const cardTypesState = stored[CARD_TYPES_KEY] || {};

  // 复用原生 SelectMenu 标记：与 Events 分组完全同构（tmp-px-3 mt-2 标题组 + SelectMenu-list）
  const section = document.createElement('div');
  section.className = 'rgf-subfilters';

  // ---- 角色范围（单选：all/self/orgs/users）----
  const scopeHead = document.createElement('div');
  scopeHead.className = 'tmp-px-3 mt-2';
  const scopeH5 = document.createElement('h5');
  scopeH5.className = 'd-flex flex-items-center';
  scopeH5.textContent = '角色范围';
  scopeHead.appendChild(scopeH5);
  section.appendChild(scopeHead);

  const scopeList = document.createElement('div');
  scopeList.className = 'SelectMenu-list SelectMenu-list--borderless';
  scopeList.setAttribute('role', 'menu');
  const roleOptions = [
    ['all', '全部角色', 'people', '显示所有发起者的动态'],
    ['self', '只看我自己的动态', 'personFill', '仅显示你本人发起的动态'],
    ['orgs', '只看组织的动态', 'organization', '仅显示组织账号发起的动态'],
    ['users', '只看其他用户的动态', 'person', '仅显示其他普通用户发起的动态'],
  ];
  const roleMode = scopeState.roleMode || 'all';
  for (const [mode, label, iconKey, desc] of roleOptions) {
    const chk = document.createElement('input');
    chk.type = 'radio';
    chk.name = 'rgf-role-mode';
    chk.checked = roleMode === mode;
    chk.dataset.roleMode = mode;
    chk.addEventListener('change', async () => {
      if (!chk.checked) return;
      scopeState.roleMode = mode;
      await chrome.storage.sync.set({ [SCOPE_KEY]: scopeState });
      applyFilter();
    });
    scopeList.appendChild(makeNativeRow({
      name: 'rgf-role-' + mode,
      iconKey,
      checked: chk.checked,
      label,
      desc,
      input: chk,
    }));
  }
  // 只看我仓库的独立开关
  const myRepoChk = document.createElement('input');
  myRepoChk.type = 'checkbox';
  myRepoChk.checked = !!scopeState.onlyMyRepos;
  myRepoChk.dataset.scope = 'onlyMyRepos';
  myRepoChk.addEventListener('change', async () => {
    scopeState.onlyMyRepos = myRepoChk.checked;
    await chrome.storage.sync.set({ [SCOPE_KEY]: scopeState });
    applyFilter();
  });
  scopeList.appendChild(makeNativeRow({
    name: 'rgf-my-repos',
    iconKey: 'repo',
    checked: myRepoChk.checked,
    label: '只看我仓库的动态',
    desc: '仅显示与你仓库相关的动态',
    input: myRepoChk,
  }));

  section.appendChild(scopeList);

  // ---- 卡片类型分组（每组复刻原生"标题组 + list"结构）----
  const groups = [
    ['社交动态', [
      ['STARRED_REPOSITORY', 'Star（仓库被 star）', 'Stars'],
      ['FORKED_REPOSITORY', 'Fork（仓库被 fork）', 'Repositories'],
      ['FOLLOW', '关注（FOLLOW）', 'Follows'],
      ['CREATED_REPOSITORY', '创建仓库', 'Repositories'],
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
  for (const [groupLabel, defs] of groups) {
    const head = document.createElement('div');
    head.className = 'tmp-px-3 mt-2';
    const h5 = document.createElement('h5');
    h5.className = 'd-flex flex-items-center';
    h5.textContent = groupLabel;
    head.appendChild(h5);
    section.appendChild(head);

    const list = document.createElement('div');
    list.className = 'SelectMenu-list SelectMenu-list--borderless';
    list.setAttribute('role', 'menu');
    const nativeInputs = {};
    for (const inp of document.querySelectorAll(
      '#feed-filter-menu input[data-targets="feed-filter.inputs"][name]')) {
      nativeInputs[inp.name] = inp;
    }
    for (const [type, label, nativeGroup] of defs) {
      const chk = document.createElement('input');
      chk.type = 'checkbox';
      // 初始态 = 扩展自有偏好（缺省全部勾选；不读写原生分组，避免同组状态矛盾）
      chk.checked = cardTypesState[type] !== false;
      chk.dataset.cardType = type;
      chk.dataset.nativeGroup = nativeGroup;
      chk.addEventListener('change', async () => {
        const next = Object.assign({}, cardTypesState);
        next[type] = chk.checked;
        await chrome.storage.sync.set({ [CARD_TYPES_KEY]: next });
        applyFilter();
      });
      const meta = NATIVE_GROUP_META[nativeGroup] || {};
      list.appendChild(makeNativeRow({
        name: nativeGroup,
        iconKey: meta.icon || 'person',
        checked: chk.checked,
        label,
        desc: meta.desc || '人们创建或 fork 的仓库',
        input: chk,
      }));
    }
    section.appendChild(list);
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