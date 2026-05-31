import { Router } from 'express'
import type { Request, Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma.js'
import { requireAuth } from '../middleware/requireAuth.js'

export const sectionsRouter = Router()

sectionsRouter.use(requireAuth)

// GET /api/sections?listId=...
sectionsRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { listId } = req.query

    const sections = await prisma.section.findMany({
      where: listId ? { listId: String(listId) } : undefined,
      include: {
        _count: {
          select: { tasks: { where: { status: { not: 'deleted' } } } },
        },
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
    const section = await prisma.section.findUnique({
      where: { id: req.params.id },
      include: {
        tasks: {
          where: { status: { not: 'deleted' } },
          include: {
            tags: { include: { tag: true } },
            children: {
              where: { status: { not: 'deleted' } },
              select: { id: true, status: true },
            },
          },
          orderBy: { order: 'asc' },
        },
      },
    })

    if (!section) {
      res.status(404).json({ error: 'Section not found' })
      return
    }

    res.json(section)
  } catch (err) {
    next(err)
  }
})

// POST /api/sections
sectionsRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, listId, order } = req.body

    if (!name || !listId) {
      res.status(400).json({ error: 'name and listId are required' })
      return
    }

    const section = await prisma.section.create({
      data: { name, listId, order: order ?? 0 },
    })

    res.status(201).json(section)
  } catch (err) {
    next(err)
  }
})

// PUT /api/sections/:id
sectionsRouter.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
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

// DELETE /api/sections/:id — tasks in section get sectionId set to null via schema SetNull
sectionsRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await prisma.section.delete({ where: { id: req.params.id } })
    res.status(204).send()
  } catch (err) {
    next(err)
  }
})
