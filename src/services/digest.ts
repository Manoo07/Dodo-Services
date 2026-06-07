import nodemailer from 'nodemailer'
import { prisma } from '../lib/prisma.js'

// ─── Transporter ─────────────────────────────────────────────────────────────

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
})

const FROM      = `Dodo <${process.env.GMAIL_USER}>`
const APP_URL   = (process.env.FRONTEND_URL || 'http://localhost:5173').split(',')[0].trim()

// ─── Date helpers ─────────────────────────────────────────────────────────────

function isToday(d: Date): boolean {
  const now = new Date()
  return d.getFullYear() === now.getFullYear() &&
         d.getMonth()    === now.getMonth()    &&
         d.getDate()     === now.getDate()
}

function isTomorrow(d: Date): boolean {
  const tom = new Date()
  tom.setDate(tom.getDate() + 1)
  return d.getFullYear() === tom.getFullYear() &&
         d.getMonth()    === tom.getMonth()    &&
         d.getDate()     === tom.getDate()
}

function formatDay(d: Date): string {
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

// ─── Priority helpers ─────────────────────────────────────────────────────────

const PRIORITY_COLOR: Record<string, string> = {
  p1: '#e05252',
  p2: '#d4853a',
  p3: '#5b9bd5',
  none: '#9ca3af',
}
const PRIORITY_LABEL: Record<string, string> = {
  p1: 'High',
  p2: 'Medium',
  p3: 'Low',
  none: '',
}

// ─── Lucide key → emoji (for email rendering) ────────────────────────────────

const LUCIDE_TO_EMOJI: Record<string, string> = {
  Briefcase: '💼', BookOpen: '📖', Star: '⭐', Home: '🏠', Heart: '❤️',
  Rocket: '🚀', Target: '🎯', Music: '🎵', Coffee: '☕', Globe: '🌍',
  Code: '💻', Zap: '⚡', Flag: '🚩', Bell: '🔔', Inbox: '📥',
  Archive: '📦', Folder: '📁', Tag: '🏷️', Users: '👥', ShoppingCart: '🛒',
  Calendar: '📅', Clipboard: '📋', Clock: '⏰', Layers: '🗂️', Lightbulb: '💡',
  Microscope: '🔬', Plane: '✈️', Shield: '🛡️', Wrench: '🔧', Dumbbell: '🏋️',
}

// ─── Task type ────────────────────────────────────────────────────────────────

interface DigestTask {
  id: string
  title: string
  priority: string
  dueDate: Date | null
  list: { name: string; icon: string; color: string } | null
}

// ─── Email builder ────────────────────────────────────────────────────────────

function buildDigestEmail(name: string, totalCount: number, sections: { label: string; accent: string; tasks: DigestTask[] }[]): string {
  const firstName = name.split(' ')[0]

  // ── Section HTML ────────────────────────────────────────────────────────────
  const sectionsHtml = sections.map(({ label, accent, tasks }) => {
    const rows = tasks.map((task) => {
      const priorityColor = PRIORITY_COLOR[task.priority] ?? '#9ca3af'
      const priorityLabel = PRIORITY_LABEL[task.priority]
      const listName      = task.list?.name ?? ''
      const rawIcon       = task.list?.icon ?? '📋'
      const listIcon      = LUCIDE_TO_EMOJI[rawIcon] ?? rawIcon

      return `
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid #f3f4f6;vertical-align:top;">
            <table cellpadding="0" cellspacing="0" border="0" width="100%">
              <tr>
                <td width="8" style="vertical-align:top;padding-top:5px;">
                  <div style="width:8px;height:8px;border-radius:50%;background:${priorityColor};flex-shrink:0;"></div>
                </td>
                <td style="padding-left:10px;">
                  <div style="font-size:14px;font-weight:500;color:#111113;line-height:1.4;">${escapeHtml(task.title)}</div>
                  <div style="margin-top:3px;display:flex;gap:8px;align-items:center;">
                    <span style="font-size:11px;color:#9ca3af;">
                      ${listIcon} ${escapeHtml(listName)}
                    </span>
                    ${priorityLabel ? `<span style="font-size:10px;font-weight:600;color:${priorityColor};text-transform:uppercase;letter-spacing:0.05em;">${priorityLabel}</span>` : ''}
                  </div>
                </td>
              </tr>
            </table>
          </td>
        </tr>`
    }).join('')

    return `
      <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:24px;">
        <tr>
          <td style="padding:0 0 8px 0;">
            <table cellpadding="0" cellspacing="0" border="0" width="100%">
              <tr>
                <td width="4" style="background:${accent};border-radius:2px;">&nbsp;</td>
                <td style="padding-left:10px;">
                  <span style="font-size:11px;font-weight:700;color:${accent};text-transform:uppercase;letter-spacing:0.1em;">${label}</span>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        ${rows}
      </table>`
  }).join('')

  // ── Summary badge ───────────────────────────────────────────────────────────
  const summaryText = totalCount === 1
    ? 'You have <strong>1 pending task</strong> due this week.'
    : `You have <strong>${totalCount} pending tasks</strong> due this week.`

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>Your Dodo Digest</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">

  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f4f4f6;padding:40px 16px;">
    <tr>
      <td align="center">
        <table cellpadding="0" cellspacing="0" border="0" width="560" style="max-width:560px;width:100%;">

          <!-- ── Logo ──────────────────────────────────── -->
          <tr>
            <td align="center" style="padding-bottom:24px;">
              <div style="display:inline-block;background:#111113;border-radius:14px;padding:14px 28px;">
                <span style="font-size:22px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;">
                  Do<span style="color:#5b9bd5;">do</span>
                </span>
              </div>
            </td>
          </tr>

          <!-- ── Card ──────────────────────────────────── -->
          <tr>
            <td style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.07);">

              <!-- Card header -->
              <table cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td style="background:linear-gradient(135deg,#111113 0%,#1e1e22 100%);padding:28px 32px 24px;">
                    <div style="font-size:11px;font-weight:600;color:#5b9bd5;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:8px;">
                      Daily Digest
                    </div>
                    <div style="font-size:22px;font-weight:700;color:#ffffff;line-height:1.3;">
                      Good evening, ${escapeHtml(firstName)}! 👋
                    </div>
                    <div style="margin-top:8px;font-size:14px;color:#9ca3af;">
                      Here's your task summary for the next 7 days.
                    </div>
                  </td>
                </tr>
              </table>

              <!-- Summary pill -->
              <table cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td style="padding:20px 32px 4px;">
                    <div style="display:inline-block;background:#f0f7ff;border:1px solid #bfdbfe;border-radius:100px;padding:6px 16px;">
                      <span style="font-size:13px;color:#2563eb;">${summaryText}</span>
                    </div>
                  </td>
                </tr>
              </table>

              <!-- Task sections -->
              <table cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td style="padding:20px 32px 8px;">
                    ${sectionsHtml}
                  </td>
                </tr>
              </table>

              <!-- CTA -->
              <table cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td align="center" style="padding:8px 32px 32px;">
                    <a href="${APP_URL}" style="display:inline-block;background:#5b9bd5;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:13px 32px;border-radius:10px;letter-spacing:-0.1px;">
                      Open Dodo →
                    </a>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- ── Footer ─────────────────────────────────── -->
          <tr>
            <td align="center" style="padding-top:24px;">
              <p style="font-size:12px;color:#9ca3af;margin:0;">
                © ${new Date().getFullYear()} Dodo · You're receiving this because you have an active account.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>

</body>
</html>`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// ─── Core digest logic ────────────────────────────────────────────────────────

export async function sendDailyDigests(): Promise<void> {
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const endOf7Days   = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7, 23, 59, 59, 999)

  const checkTime = new Date()
  const currentUtcMinutes = checkTime.getUTCHours() * 60 + checkTime.getUTCMinutes()

  // Fetch all verified users and filter by their local hour
  // digestHour = local hour (0-23), digestTimezoneOffset = raw getTimezoneOffset() minutes
  const allUsers = await prisma.user.findMany({
    where: { emailVerified: true },
    select: { id: true, email: true, name: true, digestHour: true, digestTimezoneOffset: true },
  })

  // Compute each user's local hour and keep only those whose local hour matches digestHour
  // getTimezoneOffset() = UTC - local, so local = UTC - offset
  const users = allUsers.filter((u) => {
    const userLocalMinutes = ((currentUtcMinutes - u.digestTimezoneOffset + 1440 * 2) % 1440)
    const userLocalHour = Math.floor(userLocalMinutes / 60)
    return userLocalHour === u.digestHour
  })

  console.log(`[digest] Sending to ${users.length} user(s)…`)

  for (const user of users) {
    try {
      const tasks = await prisma.task.findMany({
        where: {
          list: { userId: user.id },
          dueDate: { gte: startOfToday, lte: endOf7Days },
          status: 'active',
        },
        include: {
          list: { select: { name: true, icon: true, color: true } },
        },
        orderBy: [{ dueDate: 'asc' }, { isPinned: 'desc' }, { priority: 'asc' }],
      })

      if (tasks.length === 0) {
        console.log(`[digest] ${user.email} — no pending tasks, skipping`)
        continue
      }

      // ── Group tasks by date bucket ─────────────────────────────────────────
      const grouped: Record<string, { label: string; accent: string; tasks: DigestTask[] }> = {}

      for (const task of tasks) {
        if (!task.dueDate) continue
        const d = new Date(task.dueDate)

        let key: string
        let label: string
        let accent: string

        if (isToday(d)) {
          key    = '0_today'
          label  = '🔥 Today'
          accent = '#e05252'
        } else if (isTomorrow(d)) {
          key    = '1_tomorrow'
          label  = '⏰ Tomorrow'
          accent = '#d4853a'
        } else {
          key    = `2_${d.toISOString().slice(0, 10)}`
          label  = formatDay(d)
          accent = '#5b9bd5'
        }

        if (!grouped[key]) grouped[key] = { label, accent, tasks: [] }
        grouped[key].tasks.push({
          id:       task.id,
          title:    task.title,
          priority: task.priority,
          dueDate:  task.dueDate,
          list:     task.list,
        })
      }

      const sections = Object.keys(grouped)
        .sort()
        .map((k) => grouped[k])

      const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
      const html  = buildDigestEmail(user.name, tasks.length, sections)

      await transporter.sendMail({
        from: FROM,
        to:   user.email,
        subject: `📋 ${tasks.length} task${tasks.length > 1 ? 's' : ''} due this week — Dodo Digest`,
        html,
        text: `Hi ${user.name.split(' ')[0]},\n\nYou have ${tasks.length} pending task(s) due in the next 7 days.\n\nOpen Dodo: ${APP_URL}\n\n© ${new Date().getFullYear()} Dodo`,
      })

      console.log(`[digest] ✓ Sent to ${user.email} (${tasks.length} tasks, ${today})`)
    } catch (err) {
      console.error(`[digest] ✗ Failed for ${user.email}:`, (err as Error).message)
    }
  }
}
