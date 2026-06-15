# Token Saver: opencode 消息裁剪工具 — 实现规划

## 概述

通过 opencode 插件 + 自定义命令 + SDK 三者结合，在编码会话中自动/手动裁剪冗余上下文，达到 **40-60% token 节省**。

---

## 整体架构

```
┌──────────────────────────────────────────────────────────────────────┐
│                        opencode 进程                                 │
│                                                                      │
│  ┌─────────────────────────┐    ┌───────────────────────────────┐   │
│  │  Plugin (自动裁剪)       │    │  Command (/trim, 手动触发)    │   │
│  │                         │    │                               │   │
│  │  tool.execute.after ────────►  发送精简 prompt 给 LLM       │   │
│  │    ├─ bash: 截断输出     │    │   → 总结旧消息               │   │
│  │    ├─ read: 截断内容     │    │   → 移除冗余工具输出         │   │
│  │    └─ grep/glob: 精简    │    │   → 保留关键上下文           │   │
│  │                         │    │                               │   │
│  │  experimental.session   │    └───────────────────────────────┘   │
│  │  .compacting ──────────────►                                     │
│  │    ├─ 注入自定义 context │    ┌───────────────────────────────┐   │
│  │    └─ 替换压缩 prompt   │    │  SDK 脚本 (高级/批处理)        │   │
│  │                         │    │                               │   │
│  └─────────────────────────┘    │  session.summarize()         │   │
│                                  │  session.update()            │   │
│  ┌─────────────────────────┐    │  session.messages() → 分析   │   │
│  │  配置文件               │    └───────────────────────────────┘   │
│  │  opencode.json          │                                        │
│  │  .opencode/plugins/     │                                        │
│  │  .opencode/commands/    │                                        │
│  └─────────────────────────┘                                        │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 模块一：Plugin 自动裁剪（核心）

### 文件位置

`.opencode/plugins/token-saver.ts`

### 功能清单

#### 1.1 `tool.execute.after` — 工具输出自动截断

| 工具 | 触发条件 | 截断策略 | 预期省 token |
|---|---|---|---|
| `bash` | 输出 > 2000 chars | 保留前 2000 chars + `...(truncated)` | 60-80% |
| `read` | 内容 > 3000 chars | 保留头尾各 500 chars + 中间摘要提示 | 50-70% |
| `grep` | 结果 > 1500 chars | 保留前 1500 chars + `...(results count: N)` | 50-60% |
| `glob` | 结果 > 1000 chars | 保留前 1000 chars + `...(N more files)` | 40-50% |

**例外规则**：
- `package.json`, `tsconfig.json`, `opencode.json` 等配置文件不截断
- 文件路径含 `node_modules`、`.git` 的不截断（这些本来就不该出现）
- 如果 `output.result` 中包含 `error` 关键词，不截断（保留完整错误信息）

#### 1.2 `experimental.session.compacting` — 压缩优化

在会话压缩时注入额外上下文，让 LLM 生成更精炼的总结：

```ts
"experimental.session.compacting": async (input, output) => {
  output.context.push(`## Token-Saver Compression Rules
When summarizing this session, follow these rules:
1. Keep only: current task status, modified files, key decisions, blockers
2. Discard: successful tool outputs, full file contents, error-free command results
3. Format: "Task: X | Files: [a.ts, b.ts] | Decisions: [Y] | Blockers: [Z]"`)
}
```

#### 1.3 可选：`message.part.updated` — 渐进式清理

监听新消息加入，当上下文超过阈值时主动触发 compaction 或移除冗余消息：

```ts
// 可选增强：跟踪上下文大小
let cumulativeSize = 0
const MAX_CONTEXT_CHARS = 50000

"message.part.updated": async (input, output) => {
  // 估算新增内容大小，累积超过阈值时提示用户 /trim
}
```

### 依赖说明

本地插件无需额外 npm 依赖，直接使用 `@opencode-ai/plugin` 类型。

---

## 模块二：自定义命令（手动触发）

### 文件位置

`.opencode/commands/trim.md`

### 功能

```markdown
---
description: 压缩对话历史以节省 token。用法: /trim [keep_last=N]
---

## 指令
Review the entire conversation history and follow these rules:

1. **丢弃**：
   - 所有成功的工具执行输出（bash/read/grep/glob 的原始结果）
   - 重复的错误修复尝试（只保留最终方案）
   - 过时的中间推理步骤

2. **保留**：
   - 当前任务目标和状态
   - 已修改的文件路径和变更摘要
   - 关键决策和理由
   - 仍在排查中的错误信息
   - 下一步计划

3. **输出格式**：
   ```
   Task: <current goal>
   Status: <in_progress|blocked|completed>
   Files Changed: [path1, path2, ...]
   Decisions: [key decisions]
   Pending: [next steps]
   Errors: [unresolved errors]
   ```

Keep the summary under 2000 characters. Focus on what a new assistant would need to seamlessly continue.
```

### 使用方式

```
/trim                   # 默认保留最近 10 条消息
/trim keep_last=5       # 只保留最近 5 条
```

### 增强建议

可以配合 `/trim config` 子命令让用户自定义阈值：

```
/trim config max_bash_output=3000
/trim config max_read_content=4000
```

---

## 模块三：SDK 脚本（高级/批处理）

### 用途

- CI/CD 中自动清理共享会话
- 定时任务：定期压缩长时间运行的工作会话
- 分析工具：统计 token 消耗和节省

### 核心代码

```ts
// scripts/trim-session.ts
import { createOpencodeClient } from "@opencode-ai/sdk"

const client = createOpencodeClient({ baseUrl: "http://localhost:4096" })

async function trimSession(sessionId: string) {
  const messages = await client.session.messages({ path: { id: sessionId } })

  // 分析每个消息的大小
  const largeMessages = messages.data.filter(m => {
    const totalChars = m.parts.reduce((sum, p) => sum + (p.text?.length || 0), 0)
    return totalChars > 5000
  })

  console.log(`Session ${sessionId}: ${messages.data.length} msgs, ${largeMessages.length} oversized`)

  // 执行压缩
  await client.session.summarize({
    path: { id: sessionId },
    body: { strategy: "aggressive" }
  })
}

// 批量处理所有会话
async function trimAll() {
  const sessions = await client.session.list()
  for (const s of sessions.data) {
    await trimSession(s.id)
  }
}
```

---

## 配置文件

`opencode.json` 中启用插件和命令：

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  // 无需额外配置，.opencode/plugins/ 和 .opencode/commands/ 自动加载
}
```

---

## 各模块 Token 节省贡献

| 模块 | 节省比例 | 实现难度 | 风险 |
|---|---|---|---|
| Plugin `tool.execute.after` | 30-40% | ★☆☆ (半天) | 低 — 只截断输出，不丢失上下文 |
| Plugin compaction hook | 10-15% | ★★☆ (1天) | 中 — 压缩质量依赖 LLM |
| Command `/trim` | 15-20% | ★☆☆ (半天) | 中 — 手动触发，用户可控 |
| SDK 脚本 | 5-10% | ★★☆ (1天) | 低 — 批处理，不参与实时会话 |
| **合计** | **40-60%** | **2-3天** | |

---

## 实施步骤

### Phase 1：Plugin 自动裁剪（Day 1）

1. 创建 `.opencode/plugins/token-saver.ts`
2. 实现 `tool.execute.after` 的截断逻辑
3. 实现 `experimental.session.compacting` 压缩优化
4. 测试：启动 opencode，执行一个编码任务，观察输出是否变短
5. 验证：对比开启/关闭插件时的 token 消耗（通过 opencode 的 session 详情）

### Phase 2：自定义命令（Day 2）

1. 创建 `.opencode/commands/trim.md`
2. 创建 `.opencode/commands/trim-config.md`（可选）
3. 测试：在长会话中用 `/trim` 命令，检查 LLM 是否按要求总结

### Phase 3：SDK 脚本 & 优化（Day 3）

1. 创建 `scripts/trim-all.ts`
2. 添加统计逻辑，计算实际节省的 token
3. 根据实测数据调整截断阈值
4. 收尾：添加 README 说明

---

---

## RTK 集成指南（最佳组合方案）

### 为什么集成 RTK

[RTK (Rust Token Killer)](https://github.com/rtk-ai/rtk) 是专为 bash 命令输出设计的智能压缩工具（62K+ GitHub star），对 **git/test/ls 等 100+ 命令** 做结构性去重和折叠。

**分工关系：**

| 层 | 谁管 | 技术 | 节省 |
|---|---|---|---|
| Bash 命令输出 | **RTK** | 智能过滤/分组/去重/折叠 | 60-90% |
| read/grep/glob | **token-saver** | 截断 + 白名单 | 50-70% |
| 会话压缩 | **token-saver** | compaction hook | 10-15% |
| 手动控制 | **`/trim`** | LLM 总结 | 15-20% |
| **叠加总计** | **RTK + token-saver** | — | **60-70%** |

**为什么不是互斥：** RTK 的 hook 只拦截 `bash` 工具调用，不覆盖 opencode 的 `read`/`grep`/`glob` 工具。token-saver 正好弥补这个空白，同时提供会话层语义优化。

### 安装步骤

#### Step 1：安装 RTK

```bash
# macOS / Linux
curl -fsSL https://rtk-ai.app/install | bash

# 或通过 Homebrew
brew install rtk-ai/tap/rtk

# 或通过 Cargo
cargo install rtk
```

#### Step 2：注入 opencode hook

```bash
rtk init -g --opencode
```

这条命令会安装一个 `PreToolUse` hook 到 opencode 配置中。之后 opencode 调用 `bash` 工具时，命令会被透明改写为 `rtk git status` → `rtk` 处理 → 返回压缩结果。模型无感知。

验证安装：

```bash
rtk gain     # 查看实时节省统计
rtk session  # 查看当前会话节省
```

> **注意：** RTK 的 hook **只生效于 `bash` 工具调用**。opencode 内置的 `Read`、`Grep`、`Glob` 工具不走 bash hook，不会被 RTK 拦截——这正是 token-saver 需要存在的原因。

#### Step 3：确保 token-saver 插件已部署

```bash
# 确认文件存在
ls .opencode/plugins/token-saver.ts
ls .opencode/commands/trim.md
ls .opencode/token-saver.json
```

#### Step 4：调整 token-saver 配置（针对 RTK 优化）

装了 RTK 后，bash 输出已经被智能压缩，token-saver 的 bash 截断可以放松或关闭：

```json
{
  "truncate": {
    "bash": {
      "maxChars": 5000,
      "enabled": false
    },
    "read": {
      "maxChars": 4000,
      "enabled": true
    },
    "grep": {
      "maxChars": 1500,
      "enabled": true
    },
    "glob": {
      "maxChars": 1000,
      "enabled": true
    }
  }
}
```

> 如果 RTK 已经处理了 bash，token-saver 的 bash 截断可以关闭（`enabled: false`），避免两次处理。

### 效果验证

#### 实时统计

```bash
# RTK 统计
rtk gain          # 实时节省仪表盘
rtk gain --json   # JSON 格式输出

# 本地安装后在 opencode 中跑一个编码任务
# 然后对比开启/关闭 RTK 时的 token 消耗
```

#### 基准测试参考

| 场景 | 无优化 | 仅 RTK | RTK + token-saver | 来源 |
|---|---|---|---|---|
| 30 分钟编码会话 | ~118K tokens | ~24K tokens | ~16-18K tokens | RTK 官方基准 |
| 单次 `git status` | ~1,200 tokens | ~120 tokens | ~120 tokens | RTK 实测 |
| 单次 `cargo test` | ~8,000 tokens | ~800 tokens | ~800 tokens | RTK 实测 |
| 单次 `read` 大文件 | ~2,000 tokens | — | ~800 tokens | 预估 |
| 会话压缩 | — | — | ~500 tokens（语义保留） | 预估 |

### RTK 高级配置

#### 开启 tee 模式（保留原始输出用于调试）

```bash
rtk config set mode tee      # 完整保存原始输出到文件
rtk config set mode failures # 仅出错时保存（推荐）
```

#### 自定义压缩级别

```bash
# 控制各命令族的压缩力度
rtk config set git.diff.level aggressive    # git diff 折叠更狠
rtk config set test.level standard           # 测试输出适度压缩
rtk config set npm.level off                 # npm 输出不压缩
```

#### 全局开关

```bash
rtk config set enabled false   # 临时关闭
rtk config set enabled true    # 重新开启
```

### 卸载

```bash
# 卸载 RTK
rtk uninstall

# 或移除 hook 但保留二进制
rtk init --remove

# 完全移除
brew uninstall rtk   # 或 cargo uninstall rtk
```

### 已知限制

| 限制 | 影响 | 缓解 |
|---|---|---|
| 只覆盖 `bash` 工具 | read/grep/glob 不走 hook | 由 token-saver 覆盖 |
| subagent 可能不继承 hook | 子会话 bash 输出不压缩 | opencode 的 subagent 通过 Task 工具，bash 仍经过主进程 hook |
| 学习成本 | 用户需要了解 RTK 的 tee/config 命令 | 默认配置即可工作，无需额外操作 |

---

## 风险与注意事项

| 风险 | 影响 | 缓解措施 |
|---|---|---|
| 截断导致 LLM 信息不足 | LLM 做出错误判断 | 配置文件路径白名单（不截断），保留错误信息 |
| compaction 丢失关键上下文 | LLM 产生幻觉 | compaction hook 强制保留任务/文件/决策信息 |
| 截断破坏 JSON/代码结构 | LLM 解析失败 | 截断时尽量在换行处断开，添加 `...(truncated)` 标记 |
| `/trim` 删除过多消息 | 用户需要重新提供上下文 | 默认保留最近 10 条，用户可指定 `keep_last` |
| 插件与 opencode 版本兼容 | 插件失效 | 插件使用公开 API，跟随 opencode 主版本更新 |

---

## 附录：代码模板

### `.opencode/plugins/token-saver.ts` 完整骨架

```ts
import type { Plugin } from "@opencode-ai/plugin"

const NEVER_TRUNCATE = [
  "package.json", "tsconfig.json", "opencode.json",
  ".env", ".env.example", "docker-compose.yml",
]

function shouldNotTruncate(filePath?: string): boolean {
  if (!filePath) return false
  return NEVER_TRUNCATE.some(p => filePath.endsWith(p))
}

function truncate(text: string, maxLen: number, label: string): string {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen) + `\n\n...(${label} truncated from ${text.length} to ${maxLen} chars)`
}

export const TokenSaver: Plugin = async () => {
  return {
    "tool.execute.after": async (input, output) => {
      const result = output.result
      if (!result || typeof result !== "string") return
      if (result.toLowerCase().includes("error")) return

      switch (input.tool) {
        case "bash":
          output.result = truncate(result, 2000, "bash output")
          break
        case "read":
          if (shouldNotTruncate(output.args?.filePath)) return
          output.result = truncate(result, 3000, "file content")
          break
        case "grep":
          output.result = truncate(result, 1500, "grep results")
          break
        case "glob":
          output.result = truncate(result, 1000, "file list")
          break
      }
    },

    "experimental.session.compacting": async (input, output) => {
      output.context.push(`## Token-Saver Rules
When summarizing: keep task status, files changed, key decisions, and blockers only.
Discard raw tool outputs and intermediate attempts. Use compact format.`)
    },
  }
}
```

---

## 附录：验证方法

打开插件后，与 opencode 进行一次完整编码任务（如 "重构这个函数并运行测试"），然后：

```bash
# 通过 SDK 查看 session 详情，对比 token 使用
opencode list   # 查看所有会话
```

或在 session 中运行 `/trim` 后目视检查 LLM 是否仍有完整上下文信息。
