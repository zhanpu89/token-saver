/**
 * SDK 脚本：批量压缩 opencode 会话
 *
 * 用法：
 *   bun run scripts/trim-session.ts                     # 压缩所有会话
 *   bun run scripts/trim-session.ts --session=<id>      # 压缩指定会话
 *   bun run scripts/trim-session.ts sess-xxx            # 压缩指定会话
 *   bun run scripts/trim-session.ts --dry-run           # 预览，不实际执行
 *
 * 本脚本通过 SDK 自建临时 server，无需外部 opencode 进程。
 * 也可连接已有 server：
 *   OPENCODE_BASE_URL=http://localhost:4096 bun run scripts/trim-session.ts
 *
 * 依赖: npm install @opencode-ai/sdk
 */

import { createOpencode, createOpencodeClient } from "@opencode-ai/sdk"
import type { OpencodeClient } from "@opencode-ai/sdk"

let client: OpencodeClient
let closeServer: (() => void) | null = null
const baseUrl = process.env.OPENCODE_BASE_URL

if (baseUrl) {
  client = createOpencodeClient({ baseUrl })
} else {
  const oc = await createOpencode({ port: 0, timeout: 10000 })
  client = oc.client
  closeServer = () => oc.server.close()
}
const DRY_RUN = process.argv.includes("--dry-run")

interface SessionStats {
  id: string
  title: string
  totalMessages: number
  oversizedMessages: number
  totalChars: number
}

interface MessagePart {
  text?: string
}

async function analyzeSession(sessionId: string, title?: string): Promise<SessionStats> {
  const res = await client.session.messages({ path: { id: sessionId } })
  const messages = res.data ?? []

  let totalChars = 0
  let oversizedMessages = 0

  for (const msg of messages) {
    const parts = msg.parts ?? []
    const msgChars = parts.reduce((sum: number, p: MessagePart) => sum + (p.text?.length ?? 0), 0)
    totalChars += msgChars
    if (msgChars > 5000) oversizedMessages++
  }

  return {
    id: sessionId,
    title: title ?? sessionId,
    totalMessages: messages.length,
    oversizedMessages,
    totalChars,
  }
}

async function trimSession(sessionId: string): Promise<void> {
  if (DRY_RUN) {
    const stats = await analyzeSession(sessionId)
    console.log(
      `  📊 ${stats.totalMessages} msgs, ${stats.oversizedMessages} oversized, ` +
      `${(stats.totalChars / 1000).toFixed(0)}K chars total`
    )
    return
  }

  await client.session.summarize({ path: { id: sessionId } })
  console.log(`  ✅ Compressed`)
}

async function main() {
  const sessionArg = process.argv.find(a => a.startsWith("--session="))
  const targetId = sessionArg
    ? sessionArg.slice("--session=".length)
    : process.argv.find(a => a.startsWith("sess-"))

  if (targetId) {
    console.log(`\nAnalyzing session: ${targetId}`)
    const stats = await analyzeSession(targetId, targetId)
    console.log(`  Messages: ${stats.totalMessages}`)
    console.log(`  Oversized (>5K chars): ${stats.oversizedMessages}`)
    console.log(`  Total chars: ${(stats.totalChars / 1000).toFixed(0)}K`)

    if (!DRY_RUN) {
      console.log(`\nTrimming...`)
      await trimSession(targetId)
    }
    return
  }

  console.log(`\nFetching all sessions...`)
  const sessions = await client.session.list()
  const allSessions = sessions.data ?? []

  if (allSessions.length === 0) {
    console.log("  No sessions found.")
    return
  }

  const allStats: SessionStats[] = []

  for (const s of allSessions) {
    console.log(`\nSession: ${s.title ?? s.id}`)
    const stats = await analyzeSession(s.id, s.title)
    allStats.push(stats)
    console.log(
      `  ${stats.totalMessages} msgs, ${stats.oversizedMessages} oversized, ` +
      `${(stats.totalChars / 1000).toFixed(0)}K chars`
    )

    if (!DRY_RUN) {
      await trimSession(s.id)
    }
  }

  if (allStats.length > 1) {
    const total = allStats.reduce((sum, s) => sum + s.totalChars, 0)
    const oversized = allStats.reduce((sum, s) => sum + s.oversizedMessages, 0)
    const msgs = allStats.reduce((sum, s) => sum + s.totalMessages, 0)
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
    console.log(`Total: ${allStats.length} sessions, ${msgs} msgs, ${oversized} oversized, ${(total / 1000).toFixed(0)}K chars`)
  }
}

main().then(() => closeServer?.()).catch(err => {
  const msg = err instanceof Error ? err.message : String(err)
  if (!baseUrl && (msg.includes("ECONNREFUSED") || msg.includes("connect") || msg.includes("timeout"))) {
    console.error("Cannot start opencode server. Try setting OPENCODE_BASE_URL to a running `opencode serve` instance.")
  } else {
    console.error("Failed:", msg)
  }
  closeServer?.()
  process.exit(1)
})
