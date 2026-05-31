import { Router } from 'express'
import type { Request, Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma.js'
import { requireAuth, type AuthRequest } from '../middleware/requireAuth.js'

export const tagsRouter = Router()

tagsRouter.use(requireAuth)

const uid = (req: Request) => (req as AuthRequest).userId

// GET /api/tags
tagsRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tags = await prisma.tag.findMany({
      where: { userId: uid(req) },
      include: { _count: { select: { tasks: true } } },
      orderBy: { name: 'asc' },
    })
    res.json(tags)
  } catch (err) {
    next(err)
  }
})

// GET /api/tags/:id/tasks
tagsRouter.get('/:id/tasks', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tag = await prisma.tag.findFirst({ where: { id: req.params.id, userId: uid(req) } })
    if (!tag) { res.status(404).json({ error: 'Tag not found' }); return }

    const tasks = await prisma.task.findMany({
      where: {
        tags: { some: { tagId: req.params.id } },
        status: { not: 'deleted' },
        list: { userId: uid(req) },
      },
      include: {
        tags: { include: { tag: true } },
        list: { select: { id: true, name: true, icon: true, color: true } },
        children: {
          where: { status: { not: 'deleted' } },
          select: { id: true, status: true },
        },
      },
      orderBy: { order: 'asc' },
    })
    res.json(tasks)
  } catch (err) {
    next(err)
  }
})

// POST /api/tags
tagsRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, color } = req.body
    if (!name) { res.status(400).json({ error: 'name is required' }); return }

    const tag = await prisma.tag.upsert({
      where: { name_userId: { name: String(name).toLowerCase().trim(), userId: uid(req) } },
      update: {},
      create: {
        name: String(name).toLowerCase().trim(),
        color: color ?? '#4A90D9',
        userId: uid(req),
      },
    })
    res.status(201).json(tag)
  } catch (err) {
    next(err)
  }
})

// PUT /api/tags/:id
tagsRouter.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, color } = req.body
    const result = await prisma.tag.updateMany({
      where: { id: req.params.id, userId: uid(req) },
      data: {
        ...(name !== undefined && { name: String(name).toLowerCase().trim() }),
        ...(color !== undefined && { color }),
      },
    })
    if (result.count === 0) { res.status(404).json({ error: 'Tag not found' }); return }
    const updated = await prisma.tag.findUnique({ where: { id: req.params.id } })
    res.json(updated)
  } catch (err) {
    next(err)
  }
})

// DELETE /api/tags/:id
tagsRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await prisma.tag.deleteMany({ where: { id: req.params.id, userId: uid(req) } })
    if (result.count === 0) { res.status(404).json({ error: 'Tag not found' }); return }
    res.status(204).send()
  } catch (err) {
    next(err)
  }
})
