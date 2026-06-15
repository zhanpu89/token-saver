/**
 * SDK 脚本：批量压缩 opencode 会话
 *
 * 用法：
 *   bun run scripts/trim-session.ts                    # 压缩所有会话
 *   bun run scripts/trim-session.ts <session-id>       # 压缩指定会话
 *   bun run scripts/trim-session.ts --dry-run           # 预览，不实际执行
 *
 * 依赖: npm install @opencode-ai/sdk
 */

import { createOpencodeClient } from "@opencode-ai/sdk"

const client = createOpencodeClient({ baseUrl: "http://localhost:4096" })
const DRY_RUN = process.argv.includes("--dry-run")

interface SessionStats {
  id: string
  title: string
  totalMessages: number
  oversizedMessages: number
  totalChars: number
}

async function analyzeSession(sessionId: string): Promise<SessionStats> {
  const res = await client.session.messages({ path: { id: sessionId } })
  const messages = res.data ?? []

  let totalChars = 0
  let oversizedMessages = 0

  for (const msg of messages) {
    const parts = msg.parts ?? []
    const msgChars = parts.reduce((sum: number, p: any) => sum + (p.text?.length ?? 0), 0)
    totalChars += msgChars
    if (msgChars > 5000) oversizedMessages++
  }

  return {
    id: sessionId,
    title: sessionId,
    totalMessages: messages.length,
    oversizedMessages,
    totalChars,
  }
}

async function trimSession(sessionId: string): Promise<void> {
  const res = await client.session.messages({ path: { id: sessionId } })
  const messages = res.data ?? []

  if (messages.length === 0) {
    console.log(`  ⏭  Skipped (no messages)`)
    return
  }

  if (DRY_RUN) {
    const stats = await analyzeSession(sessionId)
    console.log(
      `  📊 ${stats.totalMessages} msgs, ${stats.oversizedMessages} oversized, ` +
      `${(stats.totalChars / 1000).toFixed(0)}K chars total`
    )
    return
  }

  await client.session.summarize({
    path: { id: sessionId },
    body: { strategy: "aggressive" },
  })
  console.log(`  ✅ Compressed`)
}

async function main() {
  const targetId = process.argv.find(a => a.startsWith("sess-") || a.length === 36)

  if (targetId) {
    console.log(`\nAnalyzing session: ${targetId}`)
    const stats = await analyzeSession(targetId)
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
    console.log(`\nSession: ${s.id}`)
    const stats = await analyzeSession(s.id)
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

main().catch(err => {
  console.error("Failed:", err)
  process.exit(1)
})
