// RefinedGithubFeeds - 公共常量与工具（内容脚本与扩展页共享，无导出语法）
'use strict';

// 存储键名
const STORAGE_KEY = 'rgf.rules';
// 总开关键
const STORAGE_ENABLED_KEY = 'rgf.enabled';

// 规则维度
const DIMENSIONS = {
  ACTOR: 'actor',       // 发起者
  REPO: 'repo',         // 仓库全名 owner/repo
  EVENT: 'event',       // 事件类型
  KEYWORD: 'keyword',   // 关键词（条目全部文本）
};

// 极性
const POLARITY = {
  DENY: 'deny',    // 命中即隐藏
  ALLOW: 'allow',  // 白名单模式：未命中任一 allow 的条目一律隐藏
};

// 事件类型内置映射：标识 -> 中文标签。页面动态收集到的未知类型按原始标识展示。
const EVENT_LABELS = {
  ForkEvent: 'Fork',
  WatchEvent: 'Star',
  PushEvent: 'Push',
  CreateEvent: '创建仓库/分支',
  ReleaseEvent: 'Release',
  IssuesEvent: 'Issue',
  PullRequestEvent: 'PR',
  IssueCommentEvent: 'Issue 评论',
  PullRequestReviewEvent: 'PR 审查',
  PublicEvent: '转为公开',
  MemberEvent: '协作者变动',
  GollumEvent: 'Wiki',
  DeleteEvent: '删除分支/标签',
};

// glob 转正则：`*` 匹配任意字符段，其余元字符转义；大小写不敏感。
function globToRegExp(pattern) {
  const escaped = pattern
    .trim()
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`, 'i');
}

// 深拷贝（结构化克隆不可用于普通对象数组时的朴素实现）
function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

// 生成规则 ID：时间戳 + 随机段，避免同毫秒冲突
function makeRuleId() {
  return `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// 规则工厂：默认 deny + actor 维度
function makeRule(partial) {
  // 显式传入的 undefined 不得覆盖默认值
  const base = {
    id: makeRuleId(),
    dimension: DIMENSIONS.ACTOR,
    pattern: '',
    polarity: POLARITY.DENY,
    enabled: true,
    hits: 0,
  };
  for (const [key, value] of Object.entries(partial || {})) {
    if (value !== undefined) base[key] = value;
  }
  return base;
}

// 校验规则对象：返回错误消息或 null
function validateRule(rule) {
  if (!rule) return '规则不能为空';
  if (!Object.values(DIMENSIONS).includes(rule.dimension)) return '未知维度';
  if (typeof rule.pattern !== 'string' || rule.pattern.trim() === '') return '匹配值不能为空';
  if (rule.pattern.length > 200) return '匹配值过长';
  if (![POLARITY.DENY, POLARITY.ALLOW].includes(rule.polarity)) return '未知极性';
  return null;
}

// 归一化整包规则列表：剔除非法项，补齐缺省字段
function normalizeRules(raw) {
  if (!Array.isArray(raw)) return [];
  // 先以工厂默认补齐缺省字段再校验，避免合法的存储残缺记录被整条剔除
  const filled = raw.map((r) => makeRule({
    id: r?.id,
    dimension: r?.dimension,
    pattern: r?.pattern,
    polarity: r?.polarity,
    enabled: r?.enabled,
    hits: r?.hits,
  }));
  return filled.filter((r) => validateRule(r) === null).map((r) => ({
    ...r,
    pattern: r.pattern.trim(),
  }));
}

// 裁决单条目：命中规则列表 + 是否隐藏（白名单模式语义，见 docs/adr/0001）
function adjudicate(item, rules, enabled) {
  if (!enabled) {
    return { hidden: false, matchedRules: [] };
  }
  const active = rules.filter((r) => r.enabled);
  if (active.length === 0) {
    return { hidden: false, matchedRules: [] };
  }
  const hasAllow = active.some((r) => r.polarity === POLARITY.ALLOW);
  const matched = [];
  for (const rule of active) {
    if (matchRule(item, rule)) {
      matched.push(rule.id);
    }
  }
  let hidden;
  if (hasAllow) {
    // 白名单模式：未命中任何 allow 即隐藏；deny 命中叠加剔除
    const hitAllow = matched.some((id) => active.find((r) => r.id === id).polarity === POLARITY.ALLOW);
    const hitDeny = matched.some((id) => active.find((r) => r.id === id).polarity === POLARITY.DENY);
    hidden = !hitAllow || hitDeny;
  } else {
    hidden = matched.length > 0;
  }
  return { hidden, matchedRules: matched };
}

// 单条规则对条目求值：按维度分派
function matchRule(item, rule) {
  switch (rule.dimension) {
    case DIMENSIONS.ACTOR:
      return matchPattern(item.actor, rule.pattern);
    case DIMENSIONS.REPO:
      return matchPattern(item.repo, rule.pattern);
    case DIMENSIONS.EVENT:
      return matchPattern(item.event, rule.pattern);
    case DIMENSIONS.KEYWORD:
      return matchPattern(item.text, rule.pattern);
    default:
      return false;
  }
}

// 通配符匹配（glob 语义，大小写不敏感；见 docs/adr/0002）
function matchPattern(value, pattern) {
  if (!value) return false;
  return globToRegExp(pattern).test(String(value));
}

// 从条目 DOM 提取过滤四要素；选择器失败时字段为 null，绝不抛错中断渲染
function extractItem(el) {
  const q = (sel) => el.querySelector(sel);
  const text = (sel) => {
    const node = q(sel);
    return node ? node.textContent.trim() : null;
  };
  const repoLink = q('a[data-hovercard-type="repository"]');
  const actorEl = q('[data-testid="actor"]') || q('a[data-hovercard-type="user"]');
  const eventBadge = q('[data-test-selector="feed-item-event-type"], [data-ga-click*="feed-item"]');
  return {
    actor: actorEl ? actorEl.textContent.replace(/^@\s*/, '').trim() || null : null,
    repo: repoLink ? repoLink.textContent.replace(/\s+/g, '').trim() || null : null,
    event: eventBadge ? eventBadge.getAttribute('data-feed-item-type') || null : null,
    text: el.textContent.replace(/\s+/g, ' ').trim(),
    el,
  };
}
