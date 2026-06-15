---
description: 压缩对话历史以节省 token。用法: /trim [keep_last=N]
---

## 指令

You are compressing a conversation history. The user specified: keep_last=$ARGUMENTS

Parse `keep_last=N` from arguments: if provided, keep the last N messages as-is and compress everything before that. Default: keep last 10.

The current session is running a 6-phase software engineering pipeline:
1. PRD — 需求分析与文档生成
2. 架构设计 — SAD + tech-stack
3. 详细设计 — 模块拆解 + OpenAPI + DDL 草稿
4. 数据库设计 — DDL 脚本
5. 编码开发 — 代码实现
6. 测试 — 用例设计 + 测试代码

Each phase includes a review gate (review-expert / code-reviewer) as a sub-step, not as a separate phase.

Apply these rules strictly:

### 1. 丢弃的内容
- 所有成功的工具执行输出（bash/read/grep/glob 的原始结果，除非包含 error）
- 重复的失败尝试（只保留最终成功的方案及原因）
- 过时的中间推理步骤
- 已完成的 SKILL.md 工作流指令内容（只保留结果摘要）

### 2. 保留的内容
- 当前所处的流水线阶段（如 "Phase 3/6: 详细设计"）
- 已完成阶段的产出物清单（doc/ 目录中的文件路径）
- 所有已修改的文件路径和变更摘要
- 关键决策及理由
- 仍存在异常的错误信息（完整保留）
- 下一步计划

### 3. 输出格式
```
Pipeline: Phase <N>/6 - <phase_name>
Status: <in_progress|completed|blocked>
Artifacts:
  - doc/prd/xxx.md
  - doc/arch/xxx.md
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
