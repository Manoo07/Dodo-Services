import { Router } from 'express'
import type { Request, Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma.js'
import { requireAuth, type AuthRequest } from '../middleware/requireAuth.js'

export const listsRouter = Router()

listsRouter.use(requireAuth)

const uid = (req: Request) => (req as AuthRequest).userId

// GET /api/lists
listsRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const lists = await prisma.list.findMany({
      where: { userId: uid(req) },
      include: {
        folder: true,
        _count: { select: { tasks: { where: { status: { not: 'deleted' } } } } },
      },
      orderBy: { order: 'asc' },
    })
    res.json(lists)
  } catch (err) {
    next(err)
  }
})

// GET /api/lists/folders/all
listsRouter.get('/folders/all', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const folders = await prisma.folder.findMany({
      where: { userId: uid(req) },
      include: {
        lists: {
          include: { _count: { select: { tasks: { where: { status: { not: 'deleted' } } } } } },
          orderBy: { order: 'asc' },
        },
      },
      orderBy: { order: 'asc' },
    })
    res.json(folders)
  } catch (err) {
    next(err)
  }
})

// GET /api/lists/:id
listsRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const list = await prisma.list.findFirst({
      where: { id: req.params.id, userId: uid(req) },
      include: {
        folder: true,
        sections: { orderBy: { order: 'asc' } },
        _count: { select: { tasks: { where: { status: { not: 'deleted' } } } } },
      },
    })
    if (!list) { res.status(404).json({ error: 'List not found' }); return }
    res.json(list)
  } catch (err) {
    next(err)
  }
})

// GET /api/lists/:id/tasks
listsRouter.get('/:id/tasks', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const list = await prisma.list.findFirst({ where: { id: req.params.id, userId: uid(req) } })
    if (!list) { res.status(404).json({ error: 'List not found' }); return }

    const tasks = await prisma.task.findMany({
      where: { listId: req.params.id, parentId: null, status: { not: 'deleted' } },
      include: {
        tags: { include: { tag: true } },
        reminders: true,
        section: { select: { id: true, name: true } },
        children: {
          where: { status: { not: 'deleted' } },
          include: {
            tags: { include: { tag: true } },
            children: {
              where: { status: { not: 'deleted' } },
              include: {
                tags: { include: { tag: true } },
                children: {
                  where: { status: { not: 'deleted' } },
                  include: {
                    tags: { include: { tag: true } },
                    children: {
                      where: { status: { not: 'deleted' } },
                      select: { id: true, title: true, status: true, order: true, priority: true },
                    },
                  },
                  orderBy: { order: 'asc' },
                },
              },
              orderBy: { order: 'asc' },
            },
          },
          orderBy: { order: 'asc' },
        },
      },
      orderBy: [{ isPinned: 'desc' }, { order: 'asc' }],
    })
    res.json(tasks)
  } catch (err) {
    next(err)
  }
})

// POST /api/lists
listsRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, icon, color, folderId, order } = req.body
    if (!name) { res.status(400).json({ error: 'name is required' }); return }
    const list = await prisma.list.create({
      data: { name, icon: icon ?? '📋', color: color ?? '#4A90D9', folderId: folderId ?? null, order: order ?? 0, userId: uid(req) },
    })
    res.status(201).json(list)
  } catch (err) {
    next(err)
  }
})

// PUT /api/lists/:id
listsRouter.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, icon, color, folderId, order } = req.body
    const list = await prisma.list.updateMany({
      where: { id: req.params.id, userId: uid(req) },
      data: {
        ...(name !== undefined && { name }),
        ...(icon !== undefined && { icon }),
        ...(color !== undefined && { color }),
        ...(folderId !== undefined && { folderId }),
        ...(order !== undefined && { order }),
      },
    })
    if (list.count === 0) { res.status(404).json({ error: 'List not found' }); return }
    const updated = await prisma.list.findUnique({ where: { id: req.params.id } })
    res.json(updated)
  } catch (err) {
    next(err)
  }
})

// DELETE /api/lists/:id
listsRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await prisma.list.deleteMany({ where: { id: req.params.id, userId: uid(req) } })
    if (result.count === 0) { res.status(404).json({ error: 'List not found' }); return }
    res.status(204).send()
  } catch (err) {
    next(err)
  }
})

// POST /api/lists/folders
listsRouter.post('/folders', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, order } = req.body
    if (!name) { res.status(400).json({ error: 'name is required' }); return }
    const folder = await prisma.folder.create({ data: { name, order: order ?? 0, userId: uid(req) } })
    res.status(201).json(folder)
  } catch (err) {
    next(err)
  }
})

// PUT /api/lists/folders/:id
listsRouter.put('/folders/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, order } = req.body
    const result = await prisma.folder.updateMany({
      where: { id: req.params.id, userId: uid(req) },
      data: { ...(name !== undefined && { name }), ...(order !== undefined && { order }) },
    })
    if (result.count === 0) { res.status(404).json({ error: 'Folder not found' }); return }
    const updated = await prisma.folder.findUnique({ where: { id: req.params.id } })
    res.json(updated)
  } catch (err) {
    next(err)
  }
})

// DELETE /api/lists/folders/:id
listsRouter.delete('/folders/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await prisma.folder.deleteMany({ where: { id: req.params.id, userId: uid(req) } })
    if (result.count === 0) { res.status(404).json({ error: 'Folder not found' }); return }
    res.status(204).send()
  } catch (err) {
    next(err)
  }
})
