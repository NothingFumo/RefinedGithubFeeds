# RefinedGithubFeeds

浏览器扩展：增强 GitHub 首页动态流（dashboard feed）的**原生 Filter 面板**——按事件类型与发起者角色过滤动态，贴近原生 UI。

## 功能

- **事件类型过滤**：10 类事件开关（Star / Fork / PR 合并 / Release 发布 / 关注 / 创建仓库 / 加入列表 / 算法推荐 / 趋势榜 / 私有转公开），按社交动态、仓库活动、发现内容三组展示
- **角色范围过滤**：单选切换——全部角色 / 自己 / 组织 / 其他用户；另有「只看我仓库」独立开关
- **完全仿原生面板**：开关行复用原生 `SelectMenu-item` 标记（octicon 图标 + 标题 + 描述 + data-selected），与原生 Events 分组逐字节同构
- **原生联动**：类型开关直接驱动原生分组复选框，快捷按钮「隐藏此类动态」同步取消对应原生分组勾选，两边状态一致
- **角标**：显示本页隐藏计数，点击临时撤销过滤（刷新恢复）

## 安装（开发者模式）

1. 克隆本仓库
2. 打开 `chrome://extensions`（Edge 为 `edge://extensions`），开启「开发者模式」
3. 「加载已解压的扩展程序」，选择本仓库根目录

## 开发

零构建步骤，源码即产物。

```bash
# 图标再生成（需 Python 3）
python tools/make_icons.py

# 裁决引擎单元测试（Node >= 18）
node tools/test_engine.js

# 端到端验证：需先启动本地服务与带 CDP 的无头 Chrome
python -m http.server 8791
chrome --headless=new --remote-debugging-port=9333 about:blank
node tools/e2e.mjs
```

