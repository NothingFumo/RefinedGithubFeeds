// RefinedGithubFeeds - popup 逻辑：总开关 + 状态展示
'use strict';

const $ = (id) => document.getElementById(id);

async function init() {
  const stored = await chrome.storage.sync.get(['rgf.enabled', 'rgf.allowedTypes']);
  $('enabled').checked = stored['rgf.enabled'] !== false;
  const allowed = Array.isArray(stored['rgf.allowedTypes']) ? stored['rgf.allowedTypes'] : null;
  const el = $('mode');
  if (allowed === null) {
    el.textContent = '未配置类型过滤：显示全部动态';
    el.classList.add('warn');
  } else {
    el.textContent = `白名单模式：仅显示 ${allowed.length} 类动态`;
    el.classList.remove('warn');
  }
}

$('enabled').addEventListener('change', async (e) => {
  await chrome.storage.sync.set({ 'rgf.enabled': e.target.checked });
});

$('open-options').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

init();
