# collections

工作中抽出来的**通用、可复用组件的个人合集**。每个条目都是独立、自包含的构建块，存档于此以便参考、复用与后续派生。

本仓库是**存档，不是运行时**。没有顶层构建、没有共享依赖图、没有集成层——组件之间互不依赖，整个仓库不作为整体运行。把每个组件当作独立单元，各有自己的 README、入口和（如有）测试。

## 组件

| 组件 | 是什么 |
|---|---|
| [`using-browser/`](using-browser/) | 通用的、业务中立的**浏览器自动化 skill**：共享 Chrome/CDP 运行时 + Playwright 与（可选、默认关闭的）Midscene 适配器，外加面向 agent 的操作纪律。 |
| [`ov-publish-consume/`](ov-publish-consume/) | 业务中立的参考实现：从 Git 管理的 Markdown 目录维护一个 **OpenViking** 资源，并通过受限的只读网关暴露（publish / gateway / consume 三个边界）。 |
| [`scriptboy/`](scriptboy/) | 小型**内网脚本分发工具**：Node.js 服务端存储每个 alias 的当前脚本内容；bash 客户端每次拉取、sha256 校验并执行当前脚本。 |

## 约定

- **彼此独立**：没有任何组件 import 或调用另一个；每个都能单独拎出去用。
- **自带文档**：每个组件都有自己的 `README.md`，从组件自己的 README 开始看。
- **就地可验**：有检查的组件在各自目录内运行，例如 `npm --prefix using-browser run verify`、`npm --prefix ov-publish-consume test`、`npm --prefix scriptboy/server run build`。
- **根目录无共享工具**：没有根 `package.json`、没有 workspace 配置。新增组件无需改动其目录之外的任何东西。
