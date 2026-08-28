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
  const actorEl = q('a[data-hovercard-type="user"]') || q('a[data-hovercard-type="organization"]');
  const eventBadge = q('[data-test-selector="feed-item-event-type"], [data-ga-click*="feed-item"]');
  // 卡片类型：主锚点 = data-hydro-view 的 feed_card.card_type（如 STARRED_REPOSITORY）
  let cardType = null;
  const hydroEl = el.matches('[data-hydro-view]') ? el : el.querySelector('[data-hydro-view]');
  if (hydroEl) {
    try {
      const payload = JSON.parse(hydroEl.getAttribute('data-hydro-view'));
      cardType = (payload?.payload?.feed_card?.card_type || null);
    } catch { /* JSON 损坏时降级到次级信号 */ }
  }
  // 次级锚点（hydro 缺失/损坏时的精确回退，全部来自实抓结构）：
  //   标题图标 feed-star/feed-forked/feed-merged/feed-tag → 四种社交与仓库动态
  //   固定文案 "Recommended for you" / "Trending repositories" → 两类推荐
  if (!cardType) {
    const icon = el.querySelector('[class*="feed-item-heading-icon"]') ||
                 el.querySelector('[class*="octicon-feed-"]');
    const iconCls = icon ? icon.getAttribute('class') : '';
    if (/octicon-feed-star\b/.test(iconCls)) cardType = 'STARRED_REPOSITORY';
    else if (/octicon-feed-forked\b/.test(iconCls)) cardType = 'FORKED_REPOSITORY';
    else if (/octicon-feed-merged\b/.test(iconCls)) cardType = 'MERGED_PULL_REQUEST';
    else if (/octicon-feed-tag\b/.test(iconCls)) cardType = 'RELEASE';
    else {
      const plain = el.textContent;
      if (/\bRecommended for you\b/.test(plain)) cardType = 'REPOSITORY_RECOMMENDATION';
      else if (/\bTrending repositories\b/.test(plain)) cardType = 'TRENDING_REPOSITORY';
      else if (/\breleased\b/.test(plain)) cardType = 'RELEASE';
      else if (/\bforked\b/.test(plain)) cardType = 'FORKED_REPOSITORY';
      else if (/\bstarred\b/.test(plain)) cardType = 'STARRED_REPOSITORY';
    }
  }
  // 发起者：优先 hovercard 链接（actor 头像/用户名），避免把仓库 owner 误当 actor
  let actor = null;
  if (actorEl) {
    actor = actorEl.getAttribute('href')?.split('/')[1] ||
            actorEl.textContent.replace(/^@\s*/, '').trim() || null;
  }
  return {
    actorEl,
    actor,
    repo: repoLink ? repoLink.textContent.replace(/\s+/g, '').trim() || null : null,
    event: eventBadge ? eventBadge.getAttribute('data-feed-item-type') || null : null,
    cardType,
    text: el.textContent.replace(/\s+/g, ' ').trim(),
    el,
  };
}

// card_type -> 原生分组映射（快捷按钮与面板开关共用；实抓校准）
const CARD_TYPE_TO_NATIVE = {
  STARRED_REPOSITORY: 'Stars',
  FORKED_REPOSITORY: 'Repositories',
  MERGED_PULL_REQUEST: 'RepositoryActivity',
  RELEASE: 'Releases',
  ADDED_TO_LIST: 'Recommendations',
  REPOSITORY_RECOMMENDATION: 'Recommendations',
  TRENDING_REPOSITORY: 'Recommendations',
  PRIVATE_TO_PUBLIC_REPOSITORY: 'Repositories',
  FOLLOW: 'Follows',
  CREATED_REPOSITORY: 'Repositories',
};

// 当前登录用户名（GitHub 在页面 meta 中注入，任意语言界面可用）
function currentUser() {
  return document.querySelector('meta[name="user-login"]')?.getAttribute('content') || null;
}
