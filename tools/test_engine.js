// RefinedGithubFeeds - 过滤引擎单元测试（白名单 + 范围判定）
'use strict';
const fs = require('fs');
const vm = require('vm');

const ctx = { document: null }; // shared.js 不依赖 DOM（currentUser 单测时注入桩）
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(__dirname + '/../src/shared.js', 'utf8'), ctx);
const { matchPattern, extractItem } =
  vm.runInContext('({ matchPattern, extractItem })', ctx);

let passed = 0, failed = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { passed++; } else { failed++; console.log(`FAIL ${name}\n  实际: ${JSON.stringify(actual)}\n  期望: ${JSON.stringify(expected)}`); }
}

// ---- 白名单语义复刻（与 content.js isExcluded 一致）----
function isExcluded(item, allowedCardTypes, uncheckedNames = []) {
  if (allowedCardTypes !== null) {
    if (!item.cardType || !allowedCardTypes.has(item.cardType)) return true;
  }
  for (const name of uncheckedNames) {
    const MAP = { Stars: 'STARRED_REPOSITORY' };
    const types = MAP[name];
    if (types && types.split(',').includes(item.cardType)) return true;
  }
  return false;
}

const ALL = new Set(['STARRED_REPOSITORY','FORKED_REPOSITORY','MERGED_PULL_REQUEST','RELEASE','ADDED_TO_LIST','REPOSITORY_RECOMMENDATION','TRENDING_REPOSITORY','PRIVATE_TO_PUBLIC_REPOSITORY']);

// 未配置：全显示
check('未配置不过滤', isExcluded({cardType:'RELEASE'}, null), false);
check('未配置无类型也不过滤', isExcluded({cardType:null}, null), false);

// 全勾选：全部显示
check('全部勾选全显示', isExcluded({cardType:'RELEASE'}, ALL), false);

// 只勾 Star：其他隐藏
const onlyStar = new Set(['STARRED_REPOSITORY']);
check('白名单外隐藏', isExcluded({cardType:'RELEASE'}, onlyStar), true);
check('白名单内显示', isExcluded({cardType:'STARRED_REPOSITORY'}, onlyStar), false);
check('无法归类条目在白名单模式下隐藏', isExcluded({cardType:null}, onlyStar), true);

// ---- glob 匹配仍可用于事件维度展示 ----
check('glob 大小写不敏感', matchPattern('TORVALDS/linux', 'torvalds/*'), true);
check('glob 通配', matchPattern('any-cli', '*-cli'), true);

console.log(`\n${passed} 通过, ${failed} 失败`);
process.exit(failed ? 1 : 0);