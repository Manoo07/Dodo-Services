import { Router } from 'express'
import type { Request, Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma.js'
import { requireAuth, type AuthRequest } from '../middleware/requireAuth.js'

export const sectionsRouter = Router()

sectionsRouter.use(requireAuth)

const uid = (req: Request) => (req as AuthRequest).userId

// GET /api/sections?listId=...
sectionsRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { listId } = req.query
    const sections = await prisma.section.findMany({
      where: {
        list: { userId: uid(req) },         // ← ownership
        ...(listId && { listId: String(listId) }),
      },
      include: {
        _count: { select: { tasks: { where: { status: { not: 'deleted' } } } } },
      },
      orderBy: { order: 'asc' },
    })
    res.json(sections)
  } catch (err) {
    next(err)
  }
})

// GET /api/sections/:id
sectionsRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const section = await prisma.section.findFirst({
      where: { id: req.params.id, list: { userId: uid(req) } },  // ← ownership
      include: {
        tasks: {
          where: { status: { not: 'deleted' } },
          include: {
            tags: { include: { tag: true } },
            children: { where: { status: { not: 'deleted' } }, select: { id: true, status: true } },
          },
          orderBy: { order: 'asc' },
        },
      },
    })
    if (!section) { res.status(404).json({ error: 'Section not found' }); return }
    res.json(section)
  } catch (err) {
    next(err)
  }
})

// POST /api/sections
sectionsRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, listId, order } = req.body
    if (!name || !listId) { res.status(400).json({ error: 'name and listId are required' }); return }

    // Verify the list belongs to this user
    const list = await prisma.list.findFirst({ where: { id: String(listId), userId: uid(req) } })
    if (!list) { res.status(403).json({ error: 'List not found or access denied' }); return }

    const section = await prisma.section.create({ data: { name, listId, order: order ?? 0 } })
    res.status(201).json(section)
  } catch (err) {
    next(err)
  }
})

// PUT /api/sections/:id
sectionsRouter.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const owned = await prisma.section.findFirst({
      where: { id: req.params.id, list: { userId: uid(req) } },
      select: { id: true },
    })
    if (!owned) { res.status(404).json({ error: 'Section not found' }); return }

    const { name, order, collapsed } = req.body
    const section = await prisma.section.update({
      where: { id: req.params.id },
      data: {
        ...(name !== undefined && { name }),
        ...(order !== undefined && { order }),
        ...(collapsed !== undefined && { collapsed }),
      },
    })
    res.json(section)
  } catch (err) {
    next(err)
  }
})

// DELETE /api/sections/:id
sectionsRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await prisma.section.deleteMany({
      where: { id: req.params.id, list: { userId: uid(req) } },  // ← ownership
    })
    if (result.count === 0) { res.status(404).json({ error: 'Section not found' }); return }
    res.status(204).send()
  } catch (err) {
    next(err)
  }
})
