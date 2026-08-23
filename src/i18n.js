// RefinedGithubFeeds - 多语言文案（跟随 GitHub 界面语言）
'use strict';

// 文案表：zh 为简体中文，en 为英文兜底
const I18N = {
  zh: {
    scopeTitle: '发起者范围',
    onlyMyRepos: '只看我仓库的动态',
    onlyMyReposHint: '条目仓库属于当前账号',
    onlyFollowers: '只看关注者的动态',
    onlyFollowersHint: '发起者在你的关注者名单中',
    followersCount: (n) => `只看关注者的动态（${n} 人）`,
    followersStale: '关注者名单未缓存或已过期',
    followersAge: (h) => `关注者名单 ${h} 小时前更新`,
    followersFresh: '关注者名单刚刚更新',
    refreshList: '刷新名单',
    fetching: '抓取中…',
    fetchFailed: '抓取失败',
    groupSocial: '社交动态',
    groupRepoActivity: '仓库活动',
    groupDiscover: '发现内容',
    typeStar: 'Star（仓库被 star）',
    typeFork: 'Fork（仓库被 fork）',
    typePrMerged: 'PR 合并',
    typeRelease: 'Release 发布',
    typeAddedToList: '加入 Star List',
    typeRecommendation: '算法推荐',
    typeTrending: '趋势榜',
    typeVisibility: '私有转公开',
    hideThisType: '隐藏此类动态',
  },
  en: {
    scopeTitle: 'Actor scope',
    onlyMyRepos: 'Only activity on my repositories',
    onlyMyReposHint: 'Repository belongs to the current account',
    onlyFollowers: 'Only activity from people I follow',
    onlyFollowersHint: 'Actor is in your follower list',
    followersCount: (n) => `Only from people I follow (${n})`,
    followersStale: 'Follower list not cached or expired',
    followersAge: (h) => `Follower list updated ${h}h ago`,
    followersFresh: 'Follower list just updated',
    refreshList: 'Refresh list',
    fetching: 'Fetching…',
    fetchFailed: 'Fetch failed',
    groupSocial: 'Social activity',
    groupRepoActivity: 'Repository activity',
    groupDiscover: 'Discoveries',
    typeStar: 'Stars (repos being starred)',
    typeFork: 'Forks (repos being forked)',
    typePrMerged: 'Merged pull requests',
    typeRelease: 'Releases',
    typeAddedToList: 'Added to list',
    typeRecommendation: 'Recommended for you',
    typeTrending: 'Trending repositories',
    typeVisibility: 'Repos going public',
    hideThisType: 'Hide this type',
  },
};

// 跟随 GitHub 界面语言：<html lang>。中文族归并到 zh，其余用 en 兜底。
function uiLocale() {
  const lang = document.documentElement.lang || '';
  if (/^zh/i.test(lang)) return 'zh';
  return 'en';
}

function t(key) {
  const loc = I18N[uiLocale()] || I18N.en;
  return loc[key] !== undefined ? loc[key] : (I18N.en[key] || key);
}
