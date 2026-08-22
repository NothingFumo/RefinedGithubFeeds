// RefinedGithubFeeds - 公共常量与工具（内容脚本与扩展页共享，无导出语法）
'use strict';

// 总开关键
const STORAGE_ENABLED_KEY = 'rgf.enabled';

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

// 通配符匹配（glob 语义，大小写不敏感；见 docs/adr/0002）
function matchPattern(value, pattern) {
  if (!value) return false;
  return globToRegExp(pattern).test(String(value));
}
function extractItem(el) {
  const q = (sel) => el.querySelector(sel);
  const text = (sel) => {
    const node = q(sel);
    return node ? node.textContent.trim() : null;
  };
  const repoLink = q('a[data-hovercard-type="repository"]');
  const actorEl = q('a[data-hovercard-type="user"]');
  const eventBadge = q('[data-test-selector="feed-item-event-type"], [data-ga-click*="feed-item"]');
  // 卡片类型：真实 DOM 中 data-hydro-view 的 feed_card.card_type（如 STARRED_REPOSITORY）
  let cardType = null;
  const hydroEl = el.matches('[data-hydro-view]') ? el : el.querySelector('[data-hydro-view]');
  if (hydroEl) {
    try {
      const payload = JSON.parse(hydroEl.getAttribute('data-hydro-view'));
      cardType = (payload?.payload?.feed_card?.card_type || null);
    } catch { /* JSON 损坏时降级为 null，不中断渲染 */ }
  }
  // 发起者：优先 hovercard 链接（actor 头像/用户名），避免把仓库 owner 误当 actor
  let actor = null;
  if (actorEl) {
    actor = actorEl.getAttribute('href')?.split('/')[1] ||
            actorEl.textContent.replace(/^@\s*/, '').trim() || null;
  }
  return {
    actor,
    repo: repoLink ? repoLink.textContent.replace(/\s+/g, '').trim() || null : null,
    event: eventBadge ? eventBadge.getAttribute('data-feed-item-type') || null : null,
    cardType,
    text: el.textContent.replace(/\s+/g, ' ').trim(),
    el,
  };
}

// 当前登录用户名（GitHub 在页面 meta 中注入，任意语言界面可用）
function currentUser() {
  return document.querySelector('meta[name="user-login"]')?.getAttribute('content') || null;
}
