# my-skills

OpenCode AI 技能集合 —— 10 个指导 AI 代理完成软件工程各阶段的指令集。

> 完整文档和安装指南请见项目根目录 [README.md](../README.md)

## 技能一览

| 技能 | 角色 | 工具名 |
|------|------|--------|
| **prd-writer** | 需求分析 → PRD | `call_prd_writer` |
| **review-expert** | 文档/用例评审 | `call_review_expert` |
| **system-architect** | 架构设计 + 技术栈 | `call_system_architect` |
| **task-decomposer** | 详设拆分 + 项目规则 | `call_task_decomposer` |
| **code-developer** | 编码实现 | `call_code_developer` |
| **code-reviewer** | 代码评审 | `call_code_reviewer` |
| **tester** | 测试用例 + 测试代码 | `call_tester` |
| **dba-designer** | 数据库 DDL 设计 | `call_dba_designer` |
| **ai-memory** | AI 记忆持久化（桥梁） | `call_ai_memory` |
| **pipeline-orchestrator** | 全流程编排器 | `call_pipeline_orchestrator` |

## 目录结构

```
skills/{skill}/
├── SKILL.md          # 技能指令（YAML + 工作流）
├── resources/        # 参考文档（术语表、检查清单、模式参考）
└── templates/        # 输出模板
```

## 插件

| 插件 | 文件 | 职责 |
|------|------|------|
| 技能编排 | `plugins/skill-agent.ts` | 将 10 个技能暴露为 `call_*` 自定义工具，负责 SKILL.md 懒加载和 subagent 调度 |
| 上下文治理 | `plugins/token-saver.ts` | 头尾保留截断策略（前 30% + 后 70%）、智能错误检测免截断、`session.compacting` 优化压缩质量，节省 40-60% token |

## 命令

| 命令 | 文件 | 职责 |
|------|------|------|
| `/trim [keep_last=N]` | `commands/trim.md` | 手动压缩当前会话，按流水线阶段保留关键上下文 |

## 最佳组合：RTK + token-saver

[RTK (Rust Token Killer)](https://github.com/rtk-ai/rtk) 是 bash 命令输出的智能压缩工具（62K+ star），与 token-saver 互补叠加。

### 分工

| 层 | 谁管 | 技术 | 节省 |
|---|---|---|---|
| Bash 命令输出 | **RTK** | git diff 折叠、test 分组、ls 去重 | 60-90% |
| read/grep/glob | **token-saver** | 截断 + 白名单 | 50-70% |
| 会话压缩 | **token-saver** | compaction hook | 10-15% |
| 手动控制 | **`/trim`** | LLM 总结 | 15-20% |
| **叠加总计** | — | — | **60-70%** |

### 一键集成

```bash
# 1. 安装 RTK
curl -fsSL https://rtk-ai.app/install | bash

# 2. 注入 opencode hook
rtk init -g --opencode

# 3. 验证
rtk gain
```

> **关键理解**：RTK 只拦截 `bash` 工具。opencode 的 `Read`/`Grep`/`Glob` 不走 bash hook——这正是 token-saver 必须存在的原因。两者配合才能全面覆盖。

### 装了 RTK 后的配置调整

编辑 `token-saver.json`，关闭 bash 截断以避免两次处理：

```json
{
  "truncate": {
    "bash": { "maxChars": 5000, "enabled": false },
    "read": { "maxChars": 4000, "enabled": true },
    "grep": { "maxChars": 1500, "enabled": true },
    "glob": { "maxChars": 1000, "enabled": true }
  }
}
```

### 效果

官方基准：30 分钟编码会话从 ~118K tokens 降至 ~24K（仅 RTK），叠加 token-saver 后预计 **~16-18K tokens**（省 **85%**）。

## 配置

调整各工具的截断阈值：编辑 `token-saver.json`。
