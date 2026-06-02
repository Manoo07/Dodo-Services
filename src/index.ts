import express from 'express'
import cors from 'cors'
import cron from 'node-cron'
import { tasksRouter } from './routes/tasks.js'
import { listsRouter } from './routes/lists.js'
import { sectionsRouter } from './routes/sections.js'
import { tagsRouter } from './routes/tags.js'
import { authRouter } from './routes/auth.js'
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js'
import { prisma } from './lib/prisma.js'
import { sendDailyDigests } from './services/digest.js'

const app = express()

// Support multiple allowed origins separated by comma
// e.g. FRONTEND_URL=https://user.github.io,http://localhost:5173
const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim())

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow server-to-server requests (no origin) and listed origins
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true)
      } else {
        callback(new Error(`CORS: origin ${origin} not allowed`))
      }
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  }),
)

app.use(express.json())
app.use(express.urlencoded({ extended: true }))

app.get('/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`
    res.json({ status: 'ok', version: '1.0.0', service: 'dodo-api', database: 'connected' })
  } catch {
    res.status(503).json({ status: 'degraded', service: 'dodo-api', database: 'disconnected' })
  }
})

app.use('/api/auth', authRouter)
app.use('/api/tasks', tasksRouter)
app.use('/api/lists', listsRouter)
app.use('/api/sections', sectionsRouter)
app.use('/api/tags', tagsRouter)

// ── Manual digest trigger (dev / testing only) ───────────────────────────────
// POST /api/digest/send  — fires the digest immediately for all users
if (process.env.NODE_ENV !== 'production') {
  app.post('/api/digest/send', async (_req, res) => {
    try {
      await sendDailyDigests()
      res.json({ ok: true, message: 'Digest sent' })
    } catch (err) {
      res.status(500).json({ error: (err as Error).message })
    }
  })
}

app.use(notFoundHandler)
app.use(errorHandler)

const PORT = Number(process.env.PORT) || 3000
const server = app.listen(PORT, () => {
  console.log(`Dodo API running on http://localhost:${PORT}`)
})

// ── Daily digest — every evening at 6 PM server time ─────────────────────────
// Cron: second minute hour day month weekday
cron.schedule('0 18 * * *', () => {
  console.log('[digest] Running evening digest…')
  void sendDailyDigests()
}, { timezone: 'UTC' })

console.log('[digest] Daily digest scheduled at 18:00 UTC')

async function shutdown(signal: string) {
  console.log(`${signal} received — shutting down`)
  server.close(async () => {
    await prisma.$disconnect()
    process.exit(0)
  })
}

process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))

export default app
