import nodemailer from 'nodemailer'
import type { Config } from '../config.ts'

export interface Mail {
  to: string
  subject: string
  text: string
  html: string
}
export interface Mailer {
  send(mail: Mail): Promise<void>
}

/** 配了 SMTP_HOST 走 SMTP（开发用 Mailpit：localhost:1025）；没配就打印到日志，方便本机调试 */
export function createMailer(smtp: Config['smtp'], log: (msg: string) => void): Mailer {
  if (!smtp.host) {
    return {
      async send(mail) {
        log(`[邮件未发送：没有配置 SMTP_HOST] 收件人 ${mail.to}｜${mail.subject}\n${mail.text}`)
      },
    }
  }
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.port === 465,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
  })
  return {
    async send(mail) {
      await transport.sendMail({ from: smtp.from, ...mail })
    },
  }
}

function layout(title: string, body: string, button: { text: string; url: string }, footnote: string) {
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f4eee2;font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;color:#2b2620">
<div style="max-width:480px;margin:0 auto;background:#fffbf2;border:1px solid #e1d5c0;border-radius:16px;padding:28px">
<div style="font-family:'Songti SC',serif;font-size:22px;font-weight:700">DayMate</div>
<h1 style="font-size:18px;margin:20px 0 8px">${title}</h1>
<p style="font-size:15px;line-height:1.7;color:#564d42">${body}</p>
<p style="margin:24px 0"><a href="${button.url}" style="display:inline-block;background:#b24824;color:#fffbf2;text-decoration:none;padding:10px 20px;border-radius:10px;font-size:15px">${button.text}</a></p>
<p style="font-size:12px;line-height:1.6;color:#8a7e6e">按钮打不开的话，复制这个地址到浏览器：<br>${button.url}</p>
<p style="font-size:12px;color:#8a7e6e">${footnote}</p>
</div></body></html>`
  const text = `${title}\n\n${body}\n\n${button.text}：${button.url}\n\n${footnote}`
  return { html, text }
}

export function verifyEmailMail(to: string, username: string, url: string): Mail {
  return {
    to,
    subject: '验证你的 DayMate 邮箱',
    ...layout(
      `${username}，欢迎来到 DayMate`,
      '点下面的按钮验证邮箱。验证后，忘记密码时可以用它找回，也能收到邮件提醒。',
      { text: '验证邮箱', url },
      '链接 24 小时内有效。如果不是你注册的，忽略这封邮件即可。',
    ),
  }
}

export function resetPasswordMail(to: string, username: string, url: string): Mail {
  return {
    to,
    subject: '重置你的 DayMate 密码',
    ...layout(
      `${username}，要重置密码吗？`,
      '有人（希望是你）申请重置 DayMate 密码。点下面的按钮设置新密码，设置后所有设备都需要重新登录。',
      { text: '设置新密码', url },
      '链接 30 分钟内有效，只能用一次。如果不是你申请的，忽略这封邮件，密码不会改变。',
    ),
  }
}

/** 提醒、早报这类通知邮件：标题 + 正文 + "打开 DayMate" 按钮 */
export function notificationMail(to: string, title: string, body: string, url: string): Mail {
  return {
    to,
    subject: title,
    ...layout(title, body.replace(/\n/g, '<br>'), { text: '打开 DayMate', url }, '不想收邮件提醒？在 DayMate「我的 → 提醒与推送」里关掉。'),
  }
}
