import type { Plugin } from "@opencode-ai/plugin"
import { execSync } from "child_process"

function rtkInPath(): boolean {
  try {
    execSync("which rtk", { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}

function rtkRewrite(command: string): string {
  try {
    return execSync(`rtk rewrite "${command.replace(/"/g, '\\"')}"`, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 3000,
    }).trim()
  } catch {
    return command
  }
}

export const RtkOpenCodePlugin: Plugin = async () => {
  if (!rtkInPath()) {
    console.warn("[rtk] rtk binary not found in PATH — plugin disabled")
    return {}
  }

  return {
    "tool.execute.before": async (input, output) => {
      const tool = String(input?.tool ?? "").toLowerCase()
      if (tool !== "bash" && tool !== "shell") return
      const args = output?.args
      if (!args || typeof args !== "object") return

      const command = (args as Record<string, unknown>).command
      if (typeof command !== "string" || !command) return

      const rewritten = rtkRewrite(command)
      if (rewritten && rewritten !== command) {
        ;(args as Record<string, unknown>).command = rewritten
      }
    },
  }
}
