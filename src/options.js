// RefinedGithubFeeds - options 页逻辑
'use strict';

const $ = (id) => document.getElementById(id);
const DIM_LABELS = { actor: '发起者', repo: '仓库', event: '事件类型', keyword: '关键词' };
const POL_LABELS = { deny: '隐藏命中', allow: '仅放行' };

let rules = [];

async function load() {
  const stored = await chrome.storage.sync.get(['rgf.rules']);
  rules = normalizeRules(stored['rgf.rules']);
  render();
}

function save() {
  return chrome.storage.sync.set({ 'rgf.rules': rules });
}

function render() {
  const tbody = $('rules');
  tbody.textContent = '';
  $('empty').hidden = rules.length > 0;
  for (const rule of rules) {
    const tr = document.createElement('tr');

    // 启停
    const tdEnabled = document.createElement('td');
    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.checked = rule.enabled;
    chk.addEventListener('change', async () => {
      rule.enabled = chk.checked;
      await save();
    });
    tdEnabled.appendChild(chk);

    // 维度
    const tdDim = document.createElement('td');
    tdDim.textContent = DIM_LABELS[rule.dimension] || rule.dimension;

    // 匹配值（行内可编辑）
    const tdPattern = document.createElement('td');
    const input = document.createElement('input');
    input.type = 'text';
    input.value = rule.pattern;
    input.addEventListener('change', async () => {
      const candidate = makeRule({ dimension: rule.dimension, pattern: input.value, polarity: rule.polarity });
      const err = validateRule(candidate);
      if (err) {
        alert(err);
        input.value = rule.pattern;
        return;
      }
      rule.pattern = input.value.trim();
      await save();
    });
    tdPattern.appendChild(input);

    // 极性
    const tdPol = document.createElement('td');
    tdPol.textContent = POL_LABELS[rule.polarity] || rule.polarity;

    // 命中统计
    const tdHits = document.createElement('td');
    tdHits.className = 'hits';
    tdHits.textContent = String(rule.hits || 0);

    // 删除
    const tdOps = document.createElement('td');
    const del = document.createElement('button');
    del.className = 'danger';
    del.textContent = '删除';
    del.addEventListener('click', async () => {
      if (!confirm(`删除规则「${DIM_LABELS[rule.dimension]} ${rule.pattern}」？`)) return;
      rules = rules.filter((r) => r.id !== rule.id);
      const stored = await chrome.storage.sync.get(['rgf.ruleHits']);
      const hits = stored['rgf.ruleHits'] || {};
      delete hits[rule.id];
      await chrome.storage.sync.set({ 'rgf.ruleHits': hits });
      await save();
      render();
    });
    tdOps.appendChild(del);

    tr.append(tdEnabled, tdDim, tdPattern, tdPol, tdHits, tdOps);
    tbody.appendChild(tr);
  }
}

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
  rules.push(rule);
  $('pattern').value = '';
  await save();
  render();
});

$('export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(rules, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'refinedgithubfeeds-rules.json';
  a.click();
  URL.revokeObjectURL(url);
});

$('import-btn').addEventListener('click', () => $('import').click());
$('import').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const imported = normalizeRules(JSON.parse(await file.text()));
    if (imported.length === 0) {
      alert('导入文件中没有合法规则');
      return;
    }
    // 幂等合并：同维同值视为同一条，保留本地命中统计
    for (const inc of imported) {
      const existing = rules.find((r) => r.dimension === inc.dimension && r.pattern.toLowerCase() === inc.pattern.toLowerCase());
      if (!existing) {
        rules.push(inc);
      }
    }
    await save();
    render();
  } catch {
    alert('JSON 解析失败');
  } finally {
    e.target.value = '';
  }
});

$('clear').addEventListener('click', async (e) => {
  e.preventDefault();
  if (!confirm('确定清空全部规则？此操作不可撤销（建议先导出备份）。')) return;
  rules = [];
  await save();
  render();
});

load();