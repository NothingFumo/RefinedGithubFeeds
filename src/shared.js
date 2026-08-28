// RefinedGithubFeeds - 公共常量与工具（内容脚本与扩展页共享，无导出语法）
'use strict';

// 总开关键
const STORAGE_ENABLED_KEY = 'rgf.enabled';

function extractItem(el) {
  const q = (sel) => el.querySelector(sel);
  const text = (sel) => {
    const node = q(sel);
    return node ? node.textContent.trim() : null;
  };
  const repoLink = q('a[data-hovercard-type="repository"]');
  // 发起者优先取条目标题（h3）内的 hovercard 链接，避免把 repo owner/协作者误当 actor
  const heading = q('h3');
  const headingActor = heading
    ? heading.querySelector('a[data-hovercard-type="user"]')
      || heading.querySelector('a[data-hovercard-type="organization"]')
    : null;
  const actorEl = headingActor
    || q('a[data-hovercard-type="user"]')
    || q('a[data-hovercard-type="organization"]');
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
// 原生 Feed 过滤面板 octicon 图标路径（提取自 GitHub dashboard 快照，16x16 viewBox）
const OCTICON_PATHS = {
  heart: 'm8 14.25.345.666a.75.75 0 0 1-.69 0l-.008-.004-.018-.01a7.152 7.152 0 0 1-.31-.17 22.055 22.055 0 0 1-3.434-2.414C2.045 10.731 0 8.35 0 5.5 0 2.836 2.086 1 4.25 1 5.797 1 7.153 1.802 8 3.02 8.847 1.802 10.203 1 11.75 1 13.914 1 16 2.836 16 5.5c0 2.85-2.045 5.231-3.885 6.818a22.066 22.066 0 0 1-3.744 2.584l-.018.01-.006.003h-.002ZM4.25 2.5c-1.336 0-2.75 1.164-2.75 3 0 2.15 1.58 4.144 3.365 5.682A20.58 20.58 0 0 0 8 13.393a20.58 20.58 0 0 0 3.135-2.211C12.92 9.644 14.5 7.65 14.5 5.5c0-1.836-1.414-3-2.75-3-1.373 0-2.609.986-3.029 2.456a.749.749 0 0 1-1.442 0C6.859 3.486 5.623 2.5 4.25 2.5Z',
  markGithub: 'M6.766 11.328c-2.063-.25-3.516-1.734-3.516-3.656 0-.781.281-1.625.75-2.188-.203-.515-.172-1.609.063-2.062.625-.078 1.468.25 1.968.703.594-.187 1.219-.281 1.985-.281.765 0 1.39.094 1.953.265.484-.437 1.344-.765 1.969-.687.218.422.25 1.515.046 2.047.5.593.766 1.39.766 2.203 0 1.922-1.453 3.375-3.547 3.64.531.344.89 1.094.89 1.954v1.625c0 .468.391.734.86.547C13.781 14.359 16 11.53 16 8.03 16 3.61 12.406 0 7.984 0 3.563 0 0 3.61 0 8.031a7.88 7.88 0 0 0 5.172 7.422c.422.156.828-.125.828-.547v-1.25c-.219.094-.5.156-.75.156-1.031 0-1.64-.562-2.078-1.609-.172-.422-.36-.672-.719-.719-.187-.015-.25-.093-.25-.187 0-.188.313-.328.625-.328.453 0 .844.281 1.25.86.313.452.64.655 1.031.655s.641-.14 1-.5c.266-.265.47-.5.657-.656',
  megaphone: 'M3.25 9a.75.75 0 0 1 .75.75c0 2.142.456 3.828.733 4.653a.122.122 0 0 0 .05.064.212.212 0 0 0 .117.033h1.31c.085 0 .18-.042.258-.152a.45.45 0 0 0 .075-.366A16.743 16.743 0 0 1 6 9.75a.75.75 0 0 1 1.5 0c0 1.588.25 2.926.494 3.85.293 1.113-.504 2.4-1.783 2.4H4.9c-.686 0-1.35-.41-1.589-1.12A16.4 16.4 0 0 1 2.5 9.75.75.75 0 0 1 3.25 9Z',
  personAdd: 'M7.9 8.548h-.001a5.528 5.528 0 0 1 3.1 4.659.75.75 0 1 1-1.498.086A4.01 4.01 0 0 0 5.5 9.5a4.01 4.01 0 0 0-4.001 3.793.75.75 0 1 1-1.498-.085 5.527 5.527 0 0 1 3.1-4.66 3.5 3.5 0 1 1 4.799 0ZM13.25 0a.75.75 0 0 1 .75.75V2h1.25a.75.75 0 0 1 0 1.5H14v1.25a.75.75 0 0 1-1.5 0V3.5h-1.25a.75.75 0 0 1 0-1.5h1.25V.75a.75.75 0 0 1 .75-.75ZM5.5 4a2 2 0 1 0-.001 3.999A2 2 0 0 0 5.5 4Z',
  repo: 'M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8ZM5 12.25a.25.25 0 0 1 .25-.25h3.5a.25.25 0 0 1 .25.25v3.25a.25.25 0 0 1-.4.2l-1.45-1.087a.249.249 0 0 0-.3 0L5.4 15.7a.25.25 0 0 1-.4-.2Z',
  star: 'M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.751.751 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Zm0 2.445L6.615 5.5a.75.75 0 0 1-.564.41l-3.097.45 2.24 2.184a.75.75 0 0 1 .216.664l-.528 3.084 2.769-1.456a.75.75 0 0 1 .698 0l2.77 1.456-.53-3.084a.75.75 0 0 1 .216-.664l2.24-2.183-3.096-.45a.75.75 0 0 1-.564-.41L8 2.694Z',
  tag: 'M1 7.775V2.75C1 1.784 1.784 1 2.75 1h5.025c.464 0 .91.184 1.238.513l6.25 6.25a1.75 1.75 0 0 1 0 2.474l-5.026 5.026a1.75 1.75 0 0 1-2.474 0l-6.25-6.25A1.752 1.752 0 0 1 1 7.775Zm1.5 0c0 .066.026.13.073.177l6.25 6.25a.25.25 0 0 0 .354 0l5.025-5.025a.25.25 0 0 0 0-.354l-6.25-6.25a.25.25 0 0 0-.177-.073H2.75a.25.25 0 0 0-.25.25ZM6 5a1 1 0 1 1 0 2 1 1 0 0 1 0-2Z',
  person: 'M10.561 8.073a6.005 6.005 0 0 1 3.432 5.142.75.75 0 1 1-1.498.07 4.5 4.5 0 0 0-8.99 0 .75.75 0 0 1-1.498-.07 6.004 6.004 0 0 1 3.431-5.142 3.999 3.999 0 1 1 5.123 0ZM10.5 5a2.5 2.5 0 1 0-5 0 2.5 2.5 0 0 0 5 0Z',
  people: 'M2 5.5a3.5 3.5 0 1 1 5.898 2.549 5.508 5.508 0 0 1 3.034 4.084.75.75 0 1 1-1.482.235 4 4 0 0 0-7.9 0 .75.75 0 0 1-1.482-.236A5.507 5.507 0 0 1 3.102 8.05 3.493 3.493 0 0 1 2 5.5ZM11 4a3.001 3.001 0 0 1 2.22 5.018 5.01 5.01 0 0 1 2.56 3.012.749.749 0 0 1-.885.954.752.752 0 0 1-.549-.514 3.507 3.507 0 0 0-2.522-2.372.75.75 0 0 1-.574-.73v-.352a.75.75 0 0 1 .416-.672A1.5 1.5 0 0 0 11 5.5.75.75 0 0 1 11 4Zm-5.5-.5a2 2 0 1 0-.001 3.999A2 2 0 0 0 5.5 3.5Z',
  personFill: 'M4.243 4.757a3.757 3.757 0 1 1 5.851 3.119 6.006 6.006 0 0 1 3.9 5.339.75.75 0 0 1-.715.784H2.721a.75.75 0 0 1-.714-.784 6.006 6.006 0 0 1 3.9-5.34 3.753 3.753 0 0 1-1.664-3.118Z',
  organization: 'M1.75 16A1.75 1.75 0 0 1 0 14.25V1.75C0 .784.784 0 1.75 0h8.5C11.216 0 12 .784 12 1.75v12.5c0 .085-.006.168-.018.25h2.268a.25.25 0 0 0 .25-.25V8.285a.25.25 0 0 0-.111-.208l-1.055-.703a.749.749 0 1 1 .832-1.248l1.055.703c.487.325.779.871.779 1.456v5.965A1.75 1.75 0 0 1 14.25 16h-3.5a.766.766 0 0 1-.197-.026c-.099.017-.2.026-.303.026h-3a.75.75 0 0 1-.75-.75V14h-1v1.25a.75.75 0 0 1-.75.75Zm-.25-1.75c0 .138.112.25.25.25H4v-1.25a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 .75.75v1.25h2.25a.25.25 0 0 0 .25-.25V1.75a.25.25 0 0 0-.25-.25h-8.5a.25.25 0 0 0-.25.25ZM3.75 6h.5a.75.75 0 0 1 0 1.5h-.5a.75.75 0 0 1 0-1.5ZM3 3.75A.75.75 0 0 1 3.75 3h.5a.75.75 0 0 1 0 1.5h-.5A.75.75 0 0 1 3 3.75Zm4 3A.75.75 0 0 1 7.75 6h.5a.75.75 0 0 1 0 1.5h-.5A.75.75 0 0 1 7 6.75ZM7.75 3h.5a.75.75 0 0 1 0 1.5h-.5a.75.75 0 0 1 0-1.5ZM3 9.75A.75.75 0 0 1 3.75 9h.5a.75.75 0 0 1 0 1.5h-.5A.75.75 0 0 1 3 9.75ZM7.75 9h.5a.75.75 0 0 1 0 1.5h-.5a.75.75 0 0 1 0-1.5Z',
};

// 原生筛选面板分组 -> card_type 集合（isExcluded 用；与 CARD_TYPE_TO_NATIVE 互为反向）
// 未列出的分组（Announcements/Sponsors/StarredRelationships）无精确 card_type，不过滤
const NATIVE_TYPE_MAP = {
  Releases: 'RELEASE',
  Sponsors: null,
  Stars: 'STARRED_REPOSITORY',
  Repositories: 'FORKED_REPOSITORY,PRIVATE_TO_PUBLIC_REPOSITORY,CREATED_REPOSITORY',
  RepositoryActivity: 'MERGED_PULL_REQUEST,PULL_REQUEST',
  Recommendations: 'REPOSITORY_RECOMMENDATION,TRENDING_REPOSITORY,ADDED_TO_LIST',
  Follows: 'FOLLOW',
};

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
