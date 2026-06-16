# token-saver

opencode 插件 + `/trim` 命令 + SDK 脚本，用于在编码会话中自动/手动裁剪冗余上下文，节省 **40-60% token**。

## 组件

| 组件 | 文件 | 职责 |
|------|------|------|
| 自动裁剪插件 | `plugins/token-saver.ts` | 工具输出头尾截断（前 30% + 后 70%）、智能错误检测免截断、`session.compacting` 优化压缩质量 |
| 手动压缩命令 | `commands/trim.md` | `/trim [keep_last=N]` 手动压缩当前会话 |
| SDK 批处理脚本 | `../scripts/trim-session.ts` | 批量压缩多个会话，支持 dry-run |
| 配置文件 | `token-saver.json` | 各工具截断阈值、白名单、压缩参数 |

## 工作原理

### 自动截断

`tool.execute.after` 钩子拦截工具输出，对超过阈值的输出做头尾保留截断：

| 工具 | 默认阈值 | 策略 |
|------|----------|------|
| bash | 2000 chars | 前 30% + 后 70%，在换行处分割 |
| read | 4000 chars | 同上 |
| grep | 1500 chars | 同上 |
| glob | 1000 chars | 同上 |
| webfetch | 4000 chars | 同上 |
| websearch | 3000 chars | 同上 |

**例外**：输出包含 `error`/`fail`/`exception`/`traceback` 等关键词时不截断（保留完整调试信息）。
**白名单**：`package.json`、`tsconfig.json`、`opencode.json`、`token-saver.json`、`.env`、`Dockerfile` 等配置文件不截断。

### 会话压缩

`experimental.session.compacting` 钩子在 LLM 压缩会话时注入精简指令，只保留：任务状态、修改的文件、关键决策、阻塞项。

### 手动压缩

`/trim [keep_last=N]` — 由 LLM 总结会话历史，丢弃工具输出和中间步骤，保留关键上下文。

## 配置

编辑 `token-saver.json` 调整阈值：

```json
{
  "truncate": {
    "bash": { "maxChars": 2000, "enabled": true },
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
