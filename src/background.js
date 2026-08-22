// RefinedGithubFeeds - 后台 Service Worker：右键菜单
'use strict';

importScripts('/src/shared.js');
const MENU_HIDE_ACTOR = 'rgf-hide-actor';
const MENU_HIDE_REPO = 'rgf-hide-repo';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_HIDE_ACTOR,
    title: 'RefinedGithubFeeds：隐藏此发起者',
    contexts: ['link'],
    documentUrlPatterns: ['https://github.com/'],
  });
  chrome.contextMenus.create({
    id: MENU_HIDE_REPO,
    title: 'RefinedGithubFeeds：隐藏此仓库',
    contexts: ['link'],
    documentUrlPatterns: ['https://github.com/'],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab || info.menuItemId !== MENU_HIDE_ACTOR && info.menuItemId !== MENU_HIDE_REPO) return;
  const dimension = info.menuItemId === MENU_HIDE_ACTOR ? 'actor' : 'repo';
  const pattern = extractTarget(info.srcUrl);
  if (!pattern) return;
  const stored = await chrome.storage.sync.get(['rgf.rules']);
  const rules = normalizeRules(stored['rgf.rules']);
  // 幂等：已存在同维同值规则则跳过
  if (rules.some((r) => r.dimension === dimension && r.pattern.toLowerCase() === pattern.toLowerCase())) {
    return;
  }
  rules.push(makeRule({ dimension, pattern }));
  await chrome.storage.sync.set({ ['rgf.rules']: rules });
});

// 从链接 URL 提取目标：仓库链接 -> owner/repo；用户链接 -> 用户名
function extractTarget(url) {
  try {
    const u = new URL(url);
    if (u.hostname !== 'github.com') return null;
    const seg = u.pathname.split('/').filter(Boolean);
    if (seg.length === 0) return null;
    // /<owner>/<repo> 开头的链接按仓库处理（排除已知非仓库段）
    const nonRepo = new Set(['orgs', 'sponsors', 'topics', 'features', 'collections', 'marketplace', 'settings', 'notifications', 'explore', 'trending']);
    if (seg.length >= 2 && !nonRepo.has(seg[0])) {
      return `${seg[0]}/${seg[1]}`;
    }
    return seg[0];
  } catch {
    return null;
  }
}