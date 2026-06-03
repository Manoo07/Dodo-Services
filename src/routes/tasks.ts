import { Router } from 'express'
import type { Request, Response, NextFunction } from 'express'
import { requireAuth, type AuthRequest } from '../middleware/requireAuth.js'
import { taskService, NotFoundError, ValidationError } from '../services/TaskService.js'
import { parsePagination } from '../types/index.js'

export const tasksRouter = Router()

tasksRouter.use(requireAuth)

const uid  = (req: Request) => (req as AuthRequest).userId

// ── Helper: map domain errors → HTTP responses ─────────────────────────────────

function handleError(err: unknown, next: NextFunction) {
  if (err instanceof NotFoundError)   return next(Object.assign(err, { status: 404 }))
  if (err instanceof ValidationError) return next(Object.assign(err, { status: 400 }))
  next(err)
}

// ── Read endpoints ─────────────────────────────────────────────────────────────

tasksRouter.get('/', async (req, res, next) => {
  try {
    const { listId, status, priority, tag, parentId } = req.query
    const tasks = await taskService.getFiltered(uid(req), {
      listId:   listId   ? String(listId)   : undefined,
      status:   status   ? String(status)   : undefined,
      priority: priority ? String(priority) : undefined,
      tag:      tag      ? String(tag)      : undefined,
      parentId: parentId !== undefined ? String(parentId) : null,
    })
    res.json(tasks)
  } catch (err) { handleError(err, next) }
})

tasksRouter.get('/all', async (req, res, next) => {
  try {
    const result = await taskService.getAllPaginated(uid(req), parsePagination(req.query as Record<string, unknown>))
    res.json({ tasks: result.data, total: result.total, page: result.page, hasMore: result.hasMore })
  } catch (err) { handleError(err, next) }
})

tasksRouter.get('/today',    async (req, res, next) => { try { res.json(await taskService.getToday(uid(req)))    } catch (e) { handleError(e, next) } })
tasksRouter.get('/next7days',async (req, res, next) => { try { res.json(await taskService.getNext7Days(uid(req)))} catch (e) { handleError(e, next) } })
tasksRouter.get('/overdue',  async (req, res, next) => { try { res.json(await taskService.getOverdue(uid(req)))  } catch (e) { handleError(e, next) } })
tasksRouter.get('/inbox',    async (req, res, next) => { try { res.json(await taskService.getInbox(uid(req)))    } catch (e) { handleError(e, next) } })
tasksRouter.get('/trash',    async (req, res, next) => { try { res.json(await taskService.getTrashed(uid(req)))  } catch (e) { handleError(e, next) } })

tasksRouter.get('/search', async (req, res, next) => {
  try {
    const { q, listId, tag, priority, status } = req.query
    if (!q) { res.status(400).json({ error: 'Query parameter q is required' }); return }
    const tasks = await taskService.search(uid(req), String(q), {
      listId:   listId   ? String(listId)   : undefined,
      tag:      tag      ? String(tag)      : undefined,
      priority: priority ? String(priority) : undefined,
      status:   status   ? String(status)   : undefined,
    })
    res.json(tasks)
  } catch (err) { handleError(err, next) }
})

tasksRouter.get('/:id', async (req, res, next) => {
  try { res.json(await taskService.getById(req.params.id, uid(req))) }
  catch (err) { handleError(err, next) }
})

// ── Write endpoints ────────────────────────────────────────────────────────────

tasksRouter.post('/', async (req, res, next) => {
  try {
    const { title, listId } = req.body
    if (!title || !listId) { res.status(400).json({ error: 'title and listId are required' }); return }

    // Verify list ownership before creating
    const { prisma } = await import('../lib/prisma.js')
    const list = await prisma.list.findFirst({ where: { id: String(listId), userId: uid(req) } })
    if (!list) { res.status(403).json({ error: 'List not found or access denied' }); return }

    const task = await taskService.create(uid(req), req.body)
    res.status(201).json(task)
  } catch (err) { handleError(err, next) }
})

tasksRouter.put('/:id', async (req, res, next) => {
  try {
    const task = await taskService.update(req.params.id, uid(req), req.body)
    res.json(task)
  } catch (err) { handleError(err, next) }
})

tasksRouter.patch('/:id/complete', async (req, res, next) => {
  try { res.json(await taskService.toggleComplete(req.params.id, uid(req))) }
  catch (err) { handleError(err, next) }
})

tasksRouter.patch('/:id/wont-do', async (req, res, next) => {
  try { res.json(await taskService.markWontDo(req.params.id, uid(req))) }
  catch (err) { handleError(err, next) }
})

tasksRouter.patch('/:id/reorder', async (req, res, next) => {
  try {
    const { order, parentId, sectionId } = req.body
    res.json(await taskService.reorder(req.params.id, uid(req), order, parentId, sectionId))
  } catch (err) { handleError(err, next) }
})

tasksRouter.patch('/:id/restore', async (req, res, next) => {
  try { res.json(await taskService.restore(req.params.id, uid(req))) }
  catch (err) { handleError(err, next) }
})

tasksRouter.post('/:id/duplicate', async (req, res, next) => {
  try { res.status(201).json(await taskService.duplicate(req.params.id, uid(req))) }
  catch (err) { handleError(err, next) }
})

tasksRouter.delete('/trash/empty', async (req, res, next) => {
  try { await taskService.emptyTrash(uid(req)); res.status(204).send() }
  catch (err) { handleError(err, next) }
})

tasksRouter.delete('/:id/permanent', async (req, res, next) => {
  try { await taskService.hardDelete(req.params.id, uid(req)); res.status(204).send() }
  catch (err) { handleError(err, next) }
})

tasksRouter.delete('/:id', async (req, res, next) => {
  try { await taskService.softDelete(req.params.id, uid(req)); res.status(204).send() }
  catch (err) { handleError(err, next) }
})
