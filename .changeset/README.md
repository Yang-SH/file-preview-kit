# changesets

本目录由 [@changesets/cli](https://github.com/changesets/changesets) 管理，是 file-preview-kit 的**版本与 CHANGELOG 单一真相源**。

## 流程

1. **发版前**：为每个用户可感知的改动添加一条变更记录：

   ```bash
   npx changeset            # 交互式：选包 → 选 bump 类型（patch/minor/major）→ 写描述
   ```

   或手工在本目录新建 `*.md` 文件（front-matter 指定包与 bump 类型）。

2. **合并后发版**：

   ```bash
   npx changeset version    # 消费所有 changeset：写 CHANGELOG.md + semver bump 包版本
   npm publish -w @file-preview/core --access public   # （需 npm 凭据；CI 中通常由 changesets/action 代办）
   ```

## bump 类型约定（方案 §12 / contractVersion 联动）

| changeset 类型 | 适用场景 | 插件契约联动 |
| --- | --- | --- |
| **patch** | bug 修复、文档、内部重构 | 不变 |
| **minor** | 新格式插件、新可选能力 | 不变 |
| **major** | 破坏性变更（`PreviewResult` 形状、`PreviewPlugin` 接口、路由语义） | 受影响插件的 `contractVersion` 同步 **+1**，并在 changeset 正文说明迁移方式 |

> `contractVersion` 是插件级契约版本（方案 §2.3）：消费者可用它判断动态加载的外部插件是否兼容当前核心。它与包 semver 相互独立、同步演进。
