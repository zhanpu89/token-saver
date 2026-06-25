import type { Plugin } from "@opencode-ai/plugin"
import { readFileSync, existsSync } from "fs"
import { basename, resolve } from "path"

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

function getDefaults(): Config {
  return {
    truncate: {
      bash: { maxChars: 2000, enabled: false },
      read: { maxChars: 2000, enabled: true },
      grep: { maxChars: 800, enabled: true },
      glob: { maxChars: 500, enabled: true },
      webfetch: { maxChars: 2000, enabled: true },
      websearch: { maxChars: 1500, enabled: true },
      task: { maxChars: 2000, enabled: true },
    },
    neverTruncatePatterns: [
      "package.json", "tsconfig.json", "opencode.json",
      "token-saver.json", "token-saver.jsonc",
      ".env", "SKILL.md",
    ],
    compacting: { enabled: true, maxSummaryChars: 2000 },
    trim: { defaultKeepLast: 10, maxSummaryChars: 2000 },
  }
}

function deepMerge(defaults: Config, overrides: Partial<Config>): Config {
  const result = { ...defaults }
  if (overrides.truncate) {
    result.truncate = { ...defaults.truncate }
    for (const [tool, rule] of Object.entries(overrides.truncate)) {
      if (rule) {
        result.truncate[tool] = { ...defaults.truncate[tool], ...rule }
      }
    }
  }
  if (overrides.neverTruncatePatterns) {
    result.neverTruncatePatterns = overrides.neverTruncatePatterns
  }
  if (overrides.compacting) {
    result.compacting = { ...defaults.compacting, ...overrides.compacting }
  }
  if (overrides.trim) {
    result.trim = { ...defaults.trim, ...overrides.trim }
  }
  return result
}

function loadConfig(worktree: string): Config {
  const defaults = getDefaults()
  const paths = [
    resolve(worktree, ".opencode/token-saver.json"),
    resolve(worktree, ".opencode/token-saver.jsonc"),
  ]
  for (const p of paths) {
    if (existsSync(p)) {
      try {
        const parsed = JSON.parse(readFileSync(p, "utf-8"))
        return deepMerge(defaults, parsed)
      } catch (e) {
        console.warn(`token-saver: failed to parse config at ${p}`, e)
      }
    }
  }
  return defaults
}

function shouldNotTruncate(filePath: string | undefined, patterns: string[]): boolean {
  if (!filePath) return false
  const fileName = basename(filePath)
  return patterns.some(p => fileName === p)
}

function truncate(text: string, maxLen: number, label: string): string {
  if (text.length <= maxLen) return text
  const totalChars = text.length

  const HEAD_RATIO = 0.3
  const headLen = Math.floor(maxLen * HEAD_RATIO)
  const tailLen = maxLen - headLen

  const headEnd = text.lastIndexOf('\n', headLen)
  const tailStart = text.indexOf('\n', totalChars - tailLen)

  let head: string, tail: string
  if (headEnd >= 0 && tailStart >= 0 && headEnd < tailStart) {
    head = text.slice(0, headEnd)
    tail = text.slice(tailStart + 1)
  } else {
    head = text.slice(0, headLen)
    tail = text.slice(totalChars - tailLen)
  }

  const info = `\n... (${label} truncated: ${totalChars} chars → ${maxLen} chars, ${text.split("\n").length} lines) ...\n`

  return head + info + tail
}

function containsError(text: string): boolean {
  return /Traceback \(most recent|Uncaught |SyntaxError:|TypeError:|ReferenceError:|RangeError:|panic:|fatal error:/u.test(text)
}

export const TokenSaver: Plugin = async (ctx) => {
  const worktree = ctx.worktree ?? ctx.directory ?? process.cwd()
  const cfg = loadConfig(worktree)

  return {
    "tool.execute.after": async (input, output) => {
      const text = output.output
      if (!text || typeof text !== "string") return
      if (containsError(text)) return

      const rule = cfg.truncate[input.tool]
      if (!rule || !rule.enabled) return

      if (input.tool === "read" && shouldNotTruncate(input.args?.filePath, cfg.neverTruncatePatterns)) return

      const LABELS: Record<string, string> = {
        bash: "bash output",
        read: "file content",
        grep: "grep results",
        glob: "file list",
        webfetch: "web content",
        websearch: "search results",
        task: "task output",
      }
      output.output = truncate(text, rule.maxChars, LABELS[input.tool] ?? "output")
    },

    "experimental.session.compacting": async (input, output) => {
      if (!cfg.compacting.enabled) return
      const maxChars = cfg.compacting.maxSummaryChars
      const keepLast = cfg.trim.defaultKeepLast
      output.context.push(`## Token-Saver Rules
When summarizing this session, follow these rules:
1. Keep only: current task status, modified files, key decisions, unresolved blockers
2. Discard: raw tool outputs (bash/read/grep/glob results), intermediate failed attempts, full SKILL.md content
3. Keep the last ${keepLast} messages as-is
4. Format: "Task: X | Files: [...] | Decisions: [...] | Blockers: [...]"
5. Output must be under ${maxChars} characters`)
    },
  }
}
