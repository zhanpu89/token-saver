---
description: 压缩对话历史以节省 token。用法: /trim [keep_last=N]
---

## 指令

You are compressing a conversation history. The user arguments are: $ARGUMENTS

Parse `keep_last=N` from arguments: if a valid number N is provided (e.g. `keep_last=5`), keep the last N messages as-is and compress everything before that. If the argument is absent, empty, or not recognized, default to keeping the last 10 messages.

Apply these rules strictly:

### 1. 丢弃的内容
- 所有成功的工具执行输出（bash/read/grep/glob 的原始结果，除非包含 error）
- 重复的失败尝试（只保留最终成功的方案及原因）
- 过时的中间推理步骤
- 已完成的 SKILL.md 工作流指令内容（只保留结果摘要）

### 2. 保留的内容
- 当前任务目标和状态
- 所有已修改的文件路径和变更摘要
- 关键决策及理由
- 仍存在异常的错误信息（完整保留）
- 下一步计划

### 3. 输出格式
```
Task: <current goal>
Status: <in_progress|completed|blocked>
Files Changed:
  - path/to/file.ts: <what changed>
Decisions:
  - <decision> (reason: <why>)
Errors:
  - <unresolved error>
Pending:
  - <next step>
```

Keep the summary under 2000 characters. Focus on what a new assistant needs to seamlessly continue.
