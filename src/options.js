// RefinedGithubFeeds - options 页逻辑：类型白名单、发起者范围与关注者名单管理
'use strict';

const $ = (id) => document.getElementById(id);
const CARD_TYPES = [
  ['STARRED_REPOSITORY', 'Star（仓库被 star）'],
  ['FORKED_REPOSITORY', 'Fork（仓库被 fork）'],
  ['MERGED_PULL_REQUEST', 'PR 合并'],
  ['RELEASE', 'Release 发布'],
  ['ADDED_TO_LIST', '加入 Star List'],
  ['REPOSITORY_RECOMMENDATION', '算法推荐'],
  ['TRENDING_REPOSITORY', '趋势榜'],
  ['PRIVATE_TO_PUBLIC_REPOSITORY', '私有转公开'],
];
const FOLLOWERS_TTL = 24 * 60 * 60 * 1000;

let allowed = null;        // Set 或 null（未配置）
let scope = { onlyFollowers: false, onlyMyRepos: false };
let followers = [];
let followersAt = 0;

async function load() {
  const stored = await chrome.storage.sync.get(['rgf.allowedTypes', 'rgf.scope', 'rgf.followers', 'rgf.followersAt']);
  allowed = Array.isArray(stored['rgf.allowedTypes']) ? new Set(stored['rgf.allowedTypes']) : null;
  scope = Object.assign({ onlyFollowers: false, onlyMyRepos: false }, stored['rgf.scope']);
  followers = stored['rgf.followers'] || [];
  followersAt = stored['rgf.followersAt'] || 0;
  renderTypes();
  renderScope();
  renderFollowers();
}

function save() {
  return chrome.storage.sync.set({
    'rgf.allowedTypes': allowed === null ? [] : [...allowed],
    'rgf.scope': scope,
  });
}

function renderTypes() {
  const box = $('types');
  box.textContent = '';
  const note = $('type-note');
  note.textContent = allowed === null
    ? '尚未配置：当前显示全部动态。勾选任意类型并保存后进入白名单模式。'
    : `白名单模式：仅显示 ${allowed.size} 类动态`;
  for (const [type, label] of CARD_TYPES) {
    const rowEl = document.createElement('label');
    rowEl.className = 'd-flex flex-items-center';
    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.checked = allowed === null || allowed.has(type);
    chk.style.marginRight = '8px';
    chk.addEventListener('change', async () => {
      if (allowed === null) allowed = new Set(CARD_TYPES.map(([t]) => t));
      chk.checked ? allowed.add(type) : allowed.delete(type);
      await save();
      note.textContent = `白名单模式：仅显示 ${allowed.size} 类动态`;
    });
    const span = document.createElement('span');
    span.textContent = label;
    rowEl.append(chk, span);
    box.appendChild(rowEl);
  }
}

function renderScope() {
  $('only-my-repos').checked = !!scope.onlyMyRepos;
  $('only-followers').checked = !!scope.onlyFollowers;
}

$('only-my-repos').addEventListener('change', async (e) => {
  scope.onlyMyRepos = e.target.checked;
  await save();
});
$('only-followers').addEventListener('change', async (e) => {
  scope.onlyFollowers = e.target.checked;
  await save();
});

function renderFollowers() {
  const age = Date.now() - followersAt;
  $('follower-count').textContent = String(followers.length);
  $('follower-age').textContent = followersAt ? `${Math.ceil(age / 3600000)} 小时前更新` : '未抓取';
  $('refresh-followers').disabled = false;
  $('refresh-followers').textContent = '立即抓取';
}

$('refresh-followers').addEventListener('click', async () => {
  const btn = $('refresh-followers');
  btn.disabled = true;
  btn.textContent = '抓取中…';
  try {
    const me = currentUser();
    if (!me) throw new Error('未登录');
    const names = [];
    for (let page = 1; page <= 10; page++) {
      const res = await fetch(`https://github.com/${me}?tab=followers&page=${page}`, { credentials: 'same-origin' });
      if (!res.ok) break;
      const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
      const found = [...doc.querySelectorAll('[data-hovercard-type="user"]')]
        .map((a) => a.getAttribute('href')).filter((h) => h && /^\/[A-Za-z0-9-]+$/.test(h)).map((h) => h.slice(1));
      names.push(...found);
      if (!doc.querySelector('.pagination a[rel="next"], a.next_page') || found.length === 0) break;
    }
    followers = [...new Set(names)];
    followersAt = Date.now();
    await chrome.storage.sync.set({ 'rgf.followers': followers, 'rgf.followersAt': followersAt });
  } catch (e) {
    alert('抓取失败：' + e.message);
  }
  renderFollowers();
});

// 清空存储的类型白名单（回到未配置状态）
$('reset-types').addEventListener('click', async () => {
  if (!confirm('恢复为显示全部动态？（清除类型白名单配置）')) return;
  allowed = null;
  await chrome.storage.sync.set({ 'rgf.allowedTypes': null });
  renderTypes();
});

load();
