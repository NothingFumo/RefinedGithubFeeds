// RefinedGithubFeeds - popup 逻辑：总开关 + 状态展示
'use strict';

const $ = (id) => document.getElementById(id);

async function init() {
  const stored = await chrome.storage.sync.get(['rgf.enabled']);
  $('enabled').checked = stored['rgf.enabled'] !== false;
}

$('enabled').addEventListener('change', async (e) => {
  await chrome.storage.sync.set({ 'rgf.enabled': e.target.checked });
});

init();
