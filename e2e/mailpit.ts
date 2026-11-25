const MAILPIT = process.env.MAILPIT_URL || 'http://localhost:8025'

/** 等收件人收到主题包含 subject 的邮件，返回正文里的第一个链接 */
export async function waitForLink(to: string, subject: string): Promise<string> {
  for (let i = 0; i < 40; i++) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}" subject:"${subject}"`)}`)
    const { messages } = (await res.json()) as { messages: { ID: string }[] }
    if (messages.length) {
      const msg = (await (await fetch(`${MAILPIT}/api/v1/message/${messages[0]!.ID}`)).json()) as { Text: string }
      const link = msg.Text.match(/https?:\/\/\S+token=[\w-]+/)?.[0]
      if (link) return link
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`Mailpit 里没等到给 ${to} 的「${subject}」邮件`)
}
