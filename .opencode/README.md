# token-saver

opencode 插件 + `/trim` 命令 + SDK 脚本，用于在编码会话中自动/手动裁剪冗余上下文，节省 **40-60% token**。

## 组件

| 组件 | 文件 | 职责 |
|------|------|------|
| 自动裁剪插件 | `plugins/token-saver.ts` | 工具输出头尾截断（前 30% + 后 70%）、智能错误检测免截断、`session.compacting` 优化压缩质量 |
| 手动压缩命令 | `commands/trim.md` | `/trim [keep_last=N]` 手动压缩当前会话 |
| SDK 批处理脚本 | `../scripts/trim-session.ts` | 批量压缩多个会话，支持 dry-run |
| 配置文件 | `token-saver.json` | 各工具截断阈值、白名单、压缩参数 |

## 设计原则：截断而非摘要

token-saver 是纯 TS 函数，**无 LLM 调用**、无额外 token 开销。机械截断（头 30% + 尾 70%），不做语义理解。

| 方案 | 开销 | 时机 |
|------|------|------|
| 头尾截断（token-saver） | 免费 | 实时工具输出 |
| LLM 摘要（compaction + `/trim`） | 额外 token | 会话级清理 |

**为何不每步都做摘要**：对每次工具输出调用 LLM 做语义压缩，省下的 token 还不够花。机械截断之所以有效，是因为：
- `read` 文件：头部有导入/结构，尾部有最新代码
- `grep` 结果：头部有最佳匹配，尾部有最后几行
- `glob` 路径：几个示例足够，100+ 路径是噪音

**逃生通道**：含 `Error`/`Exception`/`Traceback` 的内容不截断；白名单文件完整保留；支持 `read path offset=N limit=M` 精确读取；`/trim` 走 LLM 语义总结兜底。

## 工作原理

### 自动截断

`tool.execute.after` 钩子拦截工具输出，对超过阈值的输出做头尾保留截断：

| 工具 | 默认阈值 | 策略 |
|------|----------|------|
| bash | 5000 chars（由 RTK 接管，实际关闭） | 关闭（enabled: false） |
| read | 4000 chars | 前 30% + 后 70%，在换行处分割 |
| grep | 1500 chars | 同上 |
| glob | 1000 chars | 同上 |
| webfetch | 4000 chars | 同上 |
| websearch | 3000 chars | 同上 |
| task | 3000 chars | 同上 |

**例外**：输出包含 `Error`/`fail`/`exception`/`Traceback`/`cannot find`/`npm ERR`/`exit code N` 等关键词时不截断（保留完整调试信息）。
**白名单**：`package.json`、`tsconfig.json`、`opencode.json`、`token-saver.json`、`token-saver.jsonc`、`.env`、`.env.example`、`docker-compose.yml`、`.gitignore`、`Makefile`、`Dockerfile`、`SKILL.md` 不截断。

### 会话压缩

`experimental.session.compacting` 钩子在 LLM 压缩会话时注入精简指令，格式：
```
Task: X | Files: [...] | Decisions: [...] | Blockers: [...]
```

### 手动压缩

`/trim [keep_last=N]` — 由 LLM 总结会话历史，丢弃工具输出和中间步骤，保留关键上下文。

## RTK 集成

| 层 | 谁管 | 节省 |
|---|---|---|
| Bash 命令输出 | RTK（全局 PreToolUse hook） | 60-90% |
| read/grep/glob/webfetch/websearch/task | token-saver 插件 | 50-70% |
| 会话压缩 | token-saver compaction hook | 10-15% |
| 手动压缩 | `/trim` 命令 | 15-20% |

验证：`rtk v0.42.4` — 25 命令，2K tokens 节省（36.7%），单命令最高 92%。

## 配置

编辑 `token-saver.json` 调整阈值：

```json
{
  "truncate": {
    "bash": { "maxChars": 5000, "enabled": false },
    "read": { "maxChars": 4000, "enabled": true }
  }
}
```

## SDK 脚本

```sh
cd scripts
npm run trim              # 压缩所有会话
npm run trim:dry          # 预览，不实际执行
```
