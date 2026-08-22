// RefinedGithubFeeds - popup 逻辑
'use strict';

const $ = (id) => document.getElementById(id);

async function init() {
  const stored = await chrome.storage.sync.get(['rgf.rules', 'rgf.enabled']);
  $('enabled').checked = stored['rgf.enabled'] !== false;
  updateMode(normalizeRules(stored['rgf.rules']));
}

function updateMode(rules) {
  const active = rules.filter((r) => r.enabled);
  const hasAllow = active.some((r) => r.polarity === 'allow');
  const el = $('mode');
  if (!active.length) {
    el.textContent = '无启用规则：不过滤任何动态';
    el.classList.add('warn');
    return;
  }
  if (hasAllow) {
    el.textContent = '白名单模式：仅显示命中 allow 的动态';
    el.classList.remove('warn');
  } else {
    el.textContent = `黑名单模式：${active.length} 条隐藏规则`;
    el.classList.remove('warn');
  }
}

$('enabled').addEventListener('change', async (e) => {
  await chrome.storage.sync.set({ 'rgf.enabled': e.target.checked });
});

$('add').addEventListener('click', async () => {
  const rule = makeRule({
    dimension: $('dimension').value,
    pattern: $('pattern').value,
    polarity: $('polarity').value,
  });
  const err = validateRule(rule);
  if (err) {
    alert(err);
    return;
  }
  const stored = await chrome.storage.sync.get(['rgf.rules']);
  const rules = normalizeRules(stored['rgf.rules']);
  rules.push(rule);
  await chrome.storage.sync.set({ 'rgf.rules': rules });
  $('pattern').value = '';
  updateMode(rules);
});

$('open-options').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

init();