import type { Plugin } from "@opencode-ai/plugin"
import { readFileSync, existsSync } from "fs"
import { resolve } from "path"

interface TruncateRule {
  maxChars: number
  enabled: boolean
}

interface Config {
  truncate: Record<string, TruncateRule>
  neverTruncatePatterns: string[]
  compacting: { enabled: boolean; maxSummaryChars: number }
  trim: { defaultKeepLast: number; maxSummaryChars: number }
}

let config: Config | null = null

function loadConfig(worktree: string): Config {
  const paths = [
    resolve(worktree, ".opencode/token-saver.json"),
    resolve(worktree, ".opencode/token-saver.jsonc"),
  ]
  for (const p of paths) {
    if (existsSync(p)) {
      try {
        return JSON.parse(readFileSync(p, "utf-8"))
      } catch {
        // fall through
      }
    }
  }
  return {
    truncate: {
      bash: { maxChars: 2000, enabled: true },
      read: { maxChars: 3000, enabled: true },
      grep: { maxChars: 1500, enabled: true },
      glob: { maxChars: 1000, enabled: true },
      webfetch: { maxChars: 4000, enabled: true },
      websearch: { maxChars: 3000, enabled: true },
    },
    neverTruncatePatterns: [
      "package.json", "tsconfig.json", "opencode.json",
      "token-saver.json", "token-saver.jsonc",
      ".env", ".env.example", "docker-compose.yml",
      ".gitignore", "Makefile", "Dockerfile",
      "SKILL.md",
    ],
    compacting: { enabled: true, maxSummaryChars: 2000 },
    trim: { defaultKeepLast: 10, maxSummaryChars: 2000 },
  }
}

function shouldNotTruncate(filePath: string | undefined, patterns: string[]): boolean {
  if (!filePath) return false
  return patterns.some(p => filePath.endsWith(p))
}

function truncate(text: string, maxLen: number, label: string): string {
  if (text.length <= maxLen) return text
  const lines = text.split("\n")
  const totalChars = text.length

  const HEAD_RATIO = 0.3
  const headLen = Math.floor(maxLen * HEAD_RATIO)
  const tailLen = maxLen - headLen

  const headEnd = text.lastIndexOf('\n', headLen)
  const tailStart = text.indexOf('\n', totalChars - tailLen)

  let head: string, tail: string
  if (headEnd > 0 && tailStart > 0 && headEnd < tailStart) {
    head = text.slice(0, headEnd)
    tail = text.slice(tailStart + 1)
  } else {
    head = text.slice(0, headLen)
    tail = text.slice(totalChars - tailLen)
  }

  const info = `\n... (${label} truncated: ${totalChars} chars → ${maxLen} chars, ${lines.length} lines) ...\n`

  return head + info + tail
}

function containsError(text: string): boolean {
  return /\b(?:[A-Z][a-z]+)?[Ee]rror\b|\bERROR\b|\b[Ee]xception\b|\bfail(?:ed|ure)?\b|\bFAIL(?:ED|URE)?\b|[Tt]raceback\b|cannot find\b|npm ERR|exit (?:code|status)/.test(text)
}

export const TokenSaver: Plugin = async (ctx) => {
  const worktree = ctx.worktree ?? ctx.directory ?? process.cwd()
  config = loadConfig(worktree)

  return {
    "tool.execute.after": async (input, output) => {
      const result = output.result
      if (!result || typeof result !== "string") return
      if (containsError(result)) return

      const rule = config?.truncate[input.tool]
      if (!rule || !rule.enabled) return

      switch (input.tool) {
        case "bash":
          output.result = truncate(result, rule.maxChars, "bash output")
          break
        case "read":
          if (shouldNotTruncate(input.args?.filePath, config?.neverTruncatePatterns ?? [])) return
          output.result = truncate(result, rule.maxChars, "file content")
          break
        case "grep":
          output.result = truncate(result, rule.maxChars, "grep results")
          break
        case "glob":
          output.result = truncate(result, rule.maxChars, "file list")
          break
        case "webfetch":
          output.result = truncate(result, rule.maxChars, "web content")
          break
        case "websearch":
          output.result = truncate(result, rule.maxChars, "search results")
          break
      }
    },

    "experimental.session.compacting": async (input, output) => {
      if (!config?.compacting.enabled) return
      const maxChars = config.compacting.maxSummaryChars
      output.context.push(`## Token-Saver Rules
When summarizing this session, follow these rules:
1. Keep only: current pipeline stage, completed stages, modified files, key decisions, unresolved blockers
2. Discard: raw tool outputs (bash/read/grep/glob results), intermediate failed attempts, full SKILL.md content
3. Format: "Stage: X/Y | Files: [...] | Decisions: [...] | Blockers: [...]"
4. Output must be under ${maxChars} characters`)
    },
  }
}
