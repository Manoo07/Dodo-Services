import express from 'express'
import cors from 'cors'
import { tasksRouter } from './routes/tasks.js'
import { listsRouter } from './routes/lists.js'
import { sectionsRouter } from './routes/sections.js'
import { tagsRouter } from './routes/tags.js'
import { authRouter } from './routes/auth.js'
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js'
import { prisma } from './lib/prisma.js'

const app = express()

app.use(
  cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
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

app.use(notFoundHandler)
app.use(errorHandler)

const PORT = Number(process.env.PORT) || 3000
const server = app.listen(PORT, () => {
  console.log(`TaskNest API running on http://localhost:${PORT}`)
})

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
