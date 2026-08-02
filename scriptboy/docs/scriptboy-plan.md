# scriptboy — 内网脚本分发执行工具

> 一个面向小团队内网的脚本集中分发工具。服务端 `sb-server` 负责录入、存储和 serve 脚本；客户端 `sb` 是一个可直接分发的 bash 脚本，通过内置 server 地址或 `SCRIPTBOY_SERVER` 覆盖寻址，用户用 `sb <alias> [args...]` 每次从 server 拉取、校验并执行脚本。

## 1. 背景与目标

脚本在多人环境中容易出现两个问题：

- **内容不一致**：同一个脚本在不同人机器上内容不同，行为漂移，难以排查。
- **分发不统一**：新脚本和脚本更新靠聊天工具或手动复制传播，缺少统一入口。

scriptboy 要解决的核心问题是：让团队成员通过统一入口执行 server 当前登记的脚本。

当前实现目标：

- 服务端集中登记脚本。
- 客户端按 alias 精确命中脚本。
- 客户端安装后开箱即用，下载的 `sb` 脚本已内置 server 地址。
- 每次执行都从 server 拉取当前脚本内容。
- 客户端对下载内容做 sha256 完整性校验。
- 客户端用临时文件执行脚本，参数、stdio、exit code 原样透传。

## 2. 使用约束

1. **网络环境**：可信内网。
2. **团队规模**：小团队内部使用，脚本数量几十到几百。
3. **命中方式**：只支持 alias 精确命中。
4. **脚本来源**：脚本由服务端本机 CLI 录入。
5. **安全边界**：保留 sha256 完整性校验、只读 HTTP API、本机管理 CLI、禁用机制。
6. **客户端形态**：bash 脚本，通过 HTTP 下载后放入 PATH。
7. **服务端形态**：Node.js + TypeScript + Express.js + SQLite，提供 HTTP API、本机管理 CLI 和客户端安装脚本。
8. **环境变量命名**：所有 scriptboy 相关环境变量使用 `SCRIPTBOY_` 前缀。

## 3. 架构总览

```text
┌──────────── sb-server ────────────┐        ┌──────────── sb bash client ───────┐
│  本机管理 CLI                      │        │  SCRIPTBOY_DEFAULT_SERVER=...      │
│   sb-server add ./foo.sh --alias foo│        │  SCRIPTBOY_SERVER 可覆盖            │
│   sb-server update foo ./foo.sh     │        │                                   │
│   sb-server disable foo             │        │  sb foo [args...]                  │
│                                    │  HTTP  │   → resolve alias                 │
│  Express.js                        │◄──────►│   → fetch content                 │
│   GET /health                      │        │   → sha256 校验                   │
│   GET /install/sb                  │        │   → chmod temp file               │
│   GET /scripts                     │        │   → exec + cleanup                │
│   GET /scripts/{alias}/meta        │        │                                   │
│   GET /scripts/{alias}/content     │        │  sb list / info / doctor          │
│                                    │        │                                   │
│  SQLite + scripts store/           │        │  mktemp temp script               │
└────────────────────────────────────┘        └───────────────────────────────────┘
```

## 4. 核心交互

### 安装客户端

管理员启动 server：

```bash
sb-server serve --host 0.0.0.0 --port 7780 --public-url http://scriptboy.local:7780
```

用户安装 `sb`：

```bash
mkdir -p ~/.local/bin
curl -fsSL http://scriptboy.local:7780/install/sb -o ~/.local/bin/sb
chmod +x ~/.local/bin/sb
```

下载到本地的 `sb` 脚本顶部内置 server 地址：

```bash
SCRIPTBOY_DEFAULT_SERVER="http://scriptboy.local:7780"
SCRIPTBOY_SERVER="${SCRIPTBOY_SERVER:-$SCRIPTBOY_DEFAULT_SERVER}"
```

临时切换 server：

```bash
SCRIPTBOY_SERVER=http://other-server:7780 sb deploy-app
```

### 登记脚本

管理员在 server 机器上执行：

```bash
sb-server add ./deploy.sh --alias deploy-app --desc "deploy staging"
```

登记流程：

1. server CLI 校验 alias。
2. server CLI 读取脚本文件并计算 sha256。
3. 脚本内容复制到 server 本地 store 目录。
4. 脚本元数据写入 SQLite。
5. 客户端通过 alias 拉取并执行当前脚本内容。

### 执行脚本

用户执行：

```bash
sb deploy-app -- staging
```

执行流程：

1. 客户端读取 `SCRIPTBOY_SERVER`；未设置时使用脚本内置的 `SCRIPTBOY_DEFAULT_SERVER`。
2. 客户端请求 `GET /scripts/deploy-app/meta` 获取元数据。
3. 客户端请求 `GET /scripts/deploy-app/content` 下载脚本内容到临时文件。
4. 客户端计算临时文件 sha256，并与元数据中的 `SCRIPTBOY_SCRIPT_SHA256` 比对。
5. sha256 不一致时，客户端删除临时文件并拒绝执行。
6. sha256 一致时，客户端设置临时文件可执行权限并执行。
7. 客户端把 `-- staging` 原样透传给脚本。
8. 执行结束后清理临时文件。
9. `sb` 返回目标脚本的 exit code。

## 5. sb-server 设计

### 技术栈

- **Runtime**：Node.js。
- **语言**：TypeScript。
- **HTTP**：Express.js。
- **CLI**：commander。
- **SQLite**：better-sqlite3。
- **sha256**：Node.js 内置 `crypto`。
- **文件操作**：Node.js 内置 `fs` / `fs/promises`。
- **安装脚本渲染**：读取 `templates/sb.sh`，替换 `SCRIPTBOY_DEFAULT_SERVER` 占位符。

### 存储

- **SQLite**：保存脚本当前元数据。
- **本地文件 store**：按 sha256 保存脚本内容，避免重复存储。
- **当前内容模型**：每个 alias 只指向一份当前脚本内容。

### 数据模型

```text
scripts
- id
- alias unique
- description
- sha256
- size_bytes
- filename
- content_path
- enabled
- created_at
- updated_at
- created_by
- updated_by
```

sha256 是脚本内容的唯一身份。

### 本机管理 CLI

- `sb-server init --db ./scriptboy.db --store ./store`
- `sb-server serve --host 0.0.0.0 --port 7780 --public-url http://scriptboy.local:7780`
- `sb-server add <file> --alias <alias> [--desc "..."]`
- `sb-server update <alias> <file> [--desc "..."]`
- `sb-server list`
- `sb-server info <alias>`
- `sb-server disable <alias>`
- `sb-server enable <alias>`

新增、更新、禁用只能在 server 本机通过 CLI 完成。

### HTTP API

- `GET /health`
  - 返回服务状态。
- `GET /install/sb`
  - 返回已内置 `SCRIPTBOY_DEFAULT_SERVER` 的 bash 客户端脚本。
- `GET /scripts`
  - 返回 enabled 脚本列表，格式为 `text/tab-separated-values`：alias、sha256、size、description。
- `GET /scripts/{alias}`
  - 返回当前脚本 JSON 元数据。
- `GET /scripts/{alias}/meta`
  - 返回当前脚本的 bash-friendly 元数据，只允许固定 key，所有 key 使用 `SCRIPTBOY_` 前缀。
- `GET /scripts/{alias}/content`
  - 返回当前脚本内容。

`/scripts/{alias}/meta` 示例：

```text
SCRIPTBOY_SCRIPT_ALIAS=deploy-app
SCRIPTBOY_SCRIPT_SHA256=abc123...
SCRIPTBOY_SCRIPT_SIZE_BYTES=1234
SCRIPTBOY_SCRIPT_CONTENT_PATH=/scripts/deploy-app/content
```

bash client 不能直接 `source` 或 `eval` server 返回的元数据；只能逐行读取并按白名单 key 解析，value 按字段类型校验。

错误约定：

- alias 不存在：`404`
- alias 已禁用：`410`
- server 内部错误：`500`

## 6. sb-cli 设计（bash）

### 运行环境

客户端依赖：

- `bash`
- `curl`
- `mktemp`
- `chmod`
- `sha256sum`，macOS fallback 为 `shasum -a 256`

客户端不依赖 `jq`、Node.js runtime、Python、Go runtime 或包管理器。

### 配置与环境变量

客户端不维护脚本内容缓存；只在执行时创建临时文件。默认临时目录使用 `${TMPDIR:-/tmp}`，可用 `SCRIPTBOY_TMP_DIR` 覆盖。

server URL 解析顺序：

1. 当前进程环境变量 `SCRIPTBOY_SERVER`。
2. bash 脚本内置的 `SCRIPTBOY_DEFAULT_SERVER`。

客户端内部变量使用 `SCRIPTBOY_` 前缀：

- `SCRIPTBOY_TMP_DIR`
- `SCRIPTBOY_SCRIPT_ALIAS`
- `SCRIPTBOY_SCRIPT_SHA256`
- `SCRIPTBOY_SCRIPT_CONTENT_PATH`

### 命令

- `sb <alias> [args...]`
  - alias 精确解析，每次拉取、校验并执行。
- `sb list`
  - 展示 server 上已启用脚本。
- `sb info <alias>`
  - 展示 alias、description、sha256、size。
- `sb doctor`
  - 检查 bash 版本、依赖命令、server 地址、连通性、server 健康状态。
- `sb --version`
  - 展示 client 版本和内置 server 地址。

### 执行细节

- 脚本下载到临时文件后执行，不写入持久缓存。
- 每次执行都请求 server 当前内容，server 不可达时执行失败。
- 临时文件目录默认使用 `${TMPDIR:-/tmp}`，可用 `SCRIPTBOY_TMP_DIR` 覆盖。
- 下载完成后计算临时文件 sha256；不一致则删除临时文件并拒绝执行。
- 校验通过后设置临时文件可执行权限。
- 参数原样透传给脚本。
- 子进程继承当前 stdin/stdout/stderr。
- 子进程 exit code 作为 `sb` 的 exit code 返回。
- 通过 `trap` 清理临时文件，正常退出、脚本失败和中断都应尽量删除。
- bash client 使用 `set -euo pipefail`，但执行目标脚本时不能吞掉其原始 exit code。

## 7. 更新与执行

- server 每次 `add` 或 `update` 都让 alias 指向新的当前内容。
- 客户端每次执行都从 server 拉取当前内容。
- server 不可达时执行失败。
- alias 被 disable 后，客户端执行该 alias 时拒绝执行。

## 8. 安全模型

当前安全模型建立在“可信内网 + server 本机 CLI 管理”的前提上：

- **完整性校验**：客户端拉取内容后必须比对 server 返回的 sha256。
- **只读 HTTP API**：HTTP API 只提供查询、安装脚本和脚本内容下载。
- **本机管理入口**：脚本录入、更新、启用、禁用都通过 server 本机 CLI 完成。
- **禁用机制**：server 可以 disable 某 alias，客户端 resolve 到禁用状态时拒绝执行。
- **元数据解析安全**：bash client 不 `source` / `eval` server 返回的元数据，只白名单解析 `SCRIPTBOY_` key。

该安全模型不覆盖 server 被入侵或可信内网内的恶意调用；README 需要明确这一点。

## 9. 仓库结构

```text
scriptboy/
  README.md
  docs/protocol.md
  server/
    package.json
    tsconfig.json
    config.example.yaml
    src/
      app.ts
      cli.ts
      config.ts
      db.ts
      store.ts
      models.ts
      files.ts
      install.ts
      routes.ts
    templates/
      sb.sh
  cli/
    sb
  examples/
    hello.sh
    deploy-demo.sh
```

## 10. 交付范围

### server

- SQLite 初始化。
- 本地文件 store。
- `sb-server add/update/list/info/enable/disable/serve`。
- `/health`、`/install/sb`、`/scripts`、`/scripts/{alias}`、`/scripts/{alias}/meta`、`/scripts/{alias}/content`。
- alias 唯一性校验、sha256 计算、enabled/disabled 状态。
- 安装脚本渲染：把 `--public-url` 写入 `SCRIPTBOY_DEFAULT_SERVER`。

### cli

- bash `sb` 客户端。
- `SCRIPTBOY_SERVER` / `SCRIPTBOY_DEFAULT_SERVER` 寻址。
- `sb <alias> [args...]` 精确执行。
- `list/info/doctor/--version`。
- sha256 校验。
- 每次下载到临时文件执行，不做持久缓存。
- 子进程 IO 和 exit code 透传。

### examples

- 2 个示例脚本。
- README 中给出从 `sb-server add`、`curl /install/sb` 到 `sb hello` 的完整链路。

## 11. 关键默认决策

| 决策点 | 选择 | 理由 |
|---|---|---|
| 命中方式 | alias 精确匹配 | 简单、确定、易调试 |
| 脚本来源 | server 本机 CLI 录入 | 录入路径明确，便于控制当前脚本内容 |
| HTTP API | 只读 + 安装脚本 | 降低远程写入风险，同时提升开箱即用体验 |
| 存储 | SQLite + 本地文件 store | 零运维，适合小团队 |
| 完整性 | sha256 | 成本低，覆盖下载内容损坏 |
| 客户端 | bash 脚本 | 可以直接内置 server 地址，curl 下载即可用 |
| 环境变量 | `SCRIPTBOY_` 前缀 | 避免 `SERVER`、`CACHE_DIR` 等通用变量冲突 |
| 服务端 | Node.js + TypeScript + Express.js | 贴近维护者熟悉技术栈，快速实现管理 CLI、HTTP API 和安装脚本 |

## 12. 验收标准

1. server 端可以通过 CLI add 一个本地脚本。
2. server 能通过 `/install/sb` 输出已内置 `SCRIPTBOY_DEFAULT_SERVER` 的 bash 客户端。
3. client 端无需手动配置 server 地址即可通过 `sb <alias>` 拉取并执行脚本。
4. `SCRIPTBOY_SERVER=http://other-server:7780 sb <alias>` 可以临时覆盖内置地址。
5. 参数、stdin/stdout/stderr、exit code 都能正确透传。
6. 脚本更新后，client 下一次执行能拉取新 sha256 对应内容。
7. 下载内容 sha256 不匹配时，client 会拒绝执行并清理临时文件。
8. server 不可达时，client 不会执行任何本地旧脚本。
9. alias disable 后，client 执行该 alias 时会拒绝执行。
10. `sb list`、`sb info`、`sb doctor` 能正常工作。
11. bash client 不直接 `source` 或 `eval` server 返回的元数据。
