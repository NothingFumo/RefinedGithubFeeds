// RefinedGithubFeeds - 裁决引擎单元测试（Node 环境直接运行）
'use strict';
const fs = require('fs');
const vm = require('vm');

const ctx = {};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(__dirname + '/../src/shared.js', 'utf8'), ctx);
// 顶层 const 不挂到上下文对象，需在上下文内求值收集
const { adjudicate, globToRegExp, matchPattern, normalizeRules, validateRule, makeRule, DIMENSIONS, POLARITY } =
  vm.runInContext('({ adjudicate, globToRegExp, matchPattern, normalizeRules, validateRule, makeRule, DIMENSIONS, POLARITY })', ctx);
let passed = 0, failed = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { passed++; } else { failed++; console.log(`FAIL ${name}\n  实际: ${JSON.stringify(actual)}\n  期望: ${JSON.stringify(expected)}`); }
}

// ---- glob ----
check('glob 精确', matchPattern('torvalds/linux', 'torvalds/Linux'), true);
check('glob 大小写不敏感', matchPattern('TORVALDS/linux', 'torvalds/*'), true);
check('glob 通配', matchPattern('any/any-cli', '*/*-cli'), true);
check('glob 不误匹配', matchPattern('a/b', 'a/b/c'), false);
check('glob 特殊字符转义', matchPattern('a.b/c', 'a.b/*'), true);
check('glob 点不越界语义(按通配设计)', matchPattern('axb/c', 'a.b/*'), false);

// ---- 裁决：黑名单模式 ----
const denyActor = makeRule({ dimension: DIMENSIONS.ACTOR, pattern: 'spammer' });
const itemSpam = { actor: 'spammer', repo: 'x/y', event: 'PushEvent', text: 'hello' };
const itemClean = { actor: 'alice', repo: 'x/y', event: 'PushEvent', text: 'hi' };
check('deny 命中隐藏', adjudicate(itemSpam, [denyActor], true).hidden, true);
check('deny 未命中放行', adjudicate(itemClean, [denyActor], true).hidden, false);

// ---- 裁决：白名单模式（ADR-0001）----
const allowAlice = makeRule({ dimension: DIMENSIONS.ACTOR, pattern: 'alice', polarity: POLARITY.ALLOW });
check('白名单未命中即隐藏', adjudicate(itemSpam, [allowAlice], true).hidden, true);
check('白名单命中放行', adjudicate(itemClean, [allowAlice], true).hidden, false);

// 白名单 + deny 叠加
const denyRepoY = makeRule({ dimension: DIMENSIONS.REPO, pattern: 'bad/repo' });
const itemAliceBad = { actor: 'alice', repo: 'bad/repo', event: null, text: '' };
const r1 = adjudicate(itemAliceBad, [allowAlice, denyRepoY], true);
check('allow 命中但 deny 也命中 -> 隐藏', r1.hidden, true);
check('匹配规则列表含两条', r1.matchedRules.length, 2);

// ---- 维度 ----
check('事件类型维度', adjudicate({ actor: 'a', repo: 'b/c', event: 'ForkEvent', text: '' },
  [makeRule({ dimension: DIMENSIONS.EVENT, pattern: 'fork*' })], true).hidden, true);
check('关键词维度全文', adjudicate({ actor: 'a', repo: 'b/c', event: null, text: 'announcing release v2 of thing' },
  [makeRule({ dimension: DIMENSIONS.KEYWORD, pattern: '*release*' })], true).hidden, true);
check('空值字段不误配', adjudicate({ actor: null, repo: null, event: null, text: '' },
  [makeRule({ dimension: DIMENSIONS.ACTOR, pattern: '*' })], true).hidden, false);

// ---- 开关与停用规则 ----
check('总开关关闭不过滤', adjudicate(itemSpam, [denyActor], false).hidden, false);
const disabledDeny = makeRule({ dimension: DIMENSIONS.ACTOR, pattern: 'spammer', enabled: false });
check('停用规则不参与裁决', adjudicate(itemSpam, [disabledDeny], true).hidden, false);
const disabledAllow = makeRule({ dimension: DIMENSIONS.ACTOR, pattern: 'alice', polarity: POLARITY.ALLOW, enabled: false });
check('停用的 allow 不触发白名单模式', adjudicate(itemSpam, [disabledAllow, denyActor], true).hidden, true);

// ---- 归一化 ----
check('非法维度被剔除', normalizeRules([{ dimension: 'nope', pattern: 'x', polarity: 'deny' }]).length, 0);
check('缺省字段补齐', (() => { const n = normalizeRules([{ dimension: 'actor', pattern: ' a ' }])[0]; return [n.pattern === 'a', n.enabled === true, n.polarity === 'deny']; })(), [true, true, true]);
check('校验拒绝空匹配值', validateRule(makeRule({ pattern: '  ' })) !== null, true);
check('校验通过合法规则', validateRule(makeRule({ pattern: 'ok' })), null);

console.log(`\n${passed} 通过, ${failed} 失败`);
process.exit(failed ? 1 : 0);