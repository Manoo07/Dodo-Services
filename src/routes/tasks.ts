import { Router } from 'express'
import type { Request, Response, NextFunction } from 'express'
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { requireAuth } from '../middleware/requireAuth.js'

export const tasksRouter = Router()

tasksRouter.use(requireAuth)

// ─── Shared include fragments ───────────────────────────────────────────────

/** Minimal child summary used by list/view endpoints (avoids loading full subtrees) */
const CHILDREN_SUMMARY = {
  where: { status: { not: 'deleted' as const } },
  select: { id: true, status: true },
} satisfies Prisma.Task$childrenArgs

/** Include shape used by view endpoints (today, next7days, overdue, trash, tags) */
const VIEW_INCLUDE = {
  tags: { include: { tag: true } },
  list: { select: { id: true, name: true, icon: true, color: true } },
  children: CHILDREN_SUMMARY,
} satisfies Prisma.TaskInclude

/** Include shape for single-task reads and mutations that need full detail */
const DETAIL_INCLUDE = {
  tags: { include: { tag: true } },
  reminders: true,
  children: CHILDREN_SUMMARY,
} satisfies Prisma.TaskInclude

// ─── GET /api/tasks ──────────────────────────────────────────────────────────

tasksRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { listId, status, priority, tag, parentId } = req.query

    const where: Prisma.TaskWhereInput = {
      status: { not: 'deleted' },
      ...(listId && { listId: String(listId) }),
      ...(status && { status: String(status) as Prisma.EnumTaskStatusFilter }),
      ...(priority && { priority: String(priority) as Prisma.EnumPriorityFilter }),
      ...(tag && { tags: { some: { tag: { name: String(tag) } } } }),
      parentId: parentId !== undefined ? String(parentId) : null,
    }

    const tasks = await prisma.task.findMany({
      where,
      include: {
        tags: { include: { tag: true } },
        reminders: true,
        section: { select: { id: true, name: true } },
        children: CHILDREN_SUMMARY,
      },
      orderBy: [{ isPinned: 'desc' }, { order: 'asc' }, { createdAt: 'asc' }],
    })

    res.json(tasks)
  } catch (err) {
    next(err)
  }
})

// ─── GET /api/tasks/all — flat list for client-side hydration ────────────────

tasksRouter.get('/all', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const tasks = await prisma.task.findMany({
      where: { status: { not: 'deleted' } },
      include: {
        tags: { include: { tag: true } },
        reminders: true,
        list: { select: { id: true, name: true, icon: true, color: true } },
        section: { select: { id: true, name: true } },
      },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    })

    res.json(tasks)
  } catch (err) {
    next(err)
  }
})

// ─── GET /api/tasks/today ────────────────────────────────────────────────────

tasksRouter.get('/today', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const now = new Date()
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)

    const tasks = await prisma.task.findMany({
      where: {
        dueDate: { gte: startOfDay, lte: endOfDay },
        status: { not: 'deleted' },
      },
      include: VIEW_INCLUDE,
      orderBy: [{ isPinned: 'desc' }, { priority: 'asc' }, { order: 'asc' }],
    })

    res.json(tasks)
  } catch (err) {
    next(err)
  }
})

// ─── GET /api/tasks/next7days ────────────────────────────────────────────────

tasksRouter.get('/next7days', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const now = new Date()
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7, 23, 59, 59, 999)

    const tasks = await prisma.task.findMany({
      where: {
        dueDate: { gte: start, lte: end },
        status: { not: 'deleted' },
      },
      include: VIEW_INCLUDE,
      orderBy: [{ dueDate: 'asc' }, { priority: 'asc' }],
    })

    res.json(tasks)
  } catch (err) {
    next(err)
  }
})

// ─── GET /api/tasks/overdue ──────────────────────────────────────────────────

tasksRouter.get('/overdue', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const startOfToday = new Date()
    startOfToday.setHours(0, 0, 0, 0)

    const tasks = await prisma.task.findMany({
      where: {
        dueDate: { lt: startOfToday },
        status: 'active',
      },
      include: VIEW_INCLUDE,
      orderBy: { dueDate: 'asc' },
    })

    res.json(tasks)
  } catch (err) {
    next(err)
  }
})

// ─── GET /api/tasks/inbox — single query via list relation ───────────────────

tasksRouter.get('/inbox', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const tasks = await prisma.task.findMany({
      where: {
        list: { name: { equals: 'Inbox', mode: 'insensitive' } },
        parentId: null,
        status: { not: 'deleted' },
      },
      include: VIEW_INCLUDE,
      orderBy: [{ isPinned: 'desc' }, { order: 'asc' }],
    })

    res.json(tasks)
  } catch (err) {
    next(err)
  }
})

// ─── GET /api/tasks/search ───────────────────────────────────────────────────

tasksRouter.get('/search', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { q, listId, tag, priority, status } = req.query

    if (!q) {
      res.status(400).json({ error: 'Query parameter q is required' })
      return
    }

    const tasks = await prisma.task.findMany({
      where: {
        AND: [
          {
            OR: [
              { title: { contains: String(q), mode: 'insensitive' } },
              { description: { contains: String(q), mode: 'insensitive' } },
              { tags: { some: { tag: { name: { contains: String(q), mode: 'insensitive' } } } } },
            ],
          },
          { status: { not: 'deleted' } },
          ...(listId ? [{ listId: String(listId) }] : []),
          ...(tag ? [{ tags: { some: { tag: { name: String(tag) } } } }] : []),
          ...(priority ? [{ priority: String(priority) as Prisma.EnumPriorityFilter }] : []),
          ...(status ? [{ status: String(status) as Prisma.EnumTaskStatusFilter }] : []),
        ],
      },
      include: {
        tags: { include: { tag: true } },
        list: { select: { id: true, name: true, icon: true, color: true } },
        section: { select: { id: true, name: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    })

    res.json(tasks)
  } catch (err) {
    next(err)
  }
})

// ─── GET /api/tasks/trash ────────────────────────────────────────────────────

tasksRouter.get('/trash', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const tasks = await prisma.task.findMany({
      where: { status: 'deleted' },
      include: {
        tags: { include: { tag: true } },
        list: { select: { id: true, name: true, icon: true, color: true } },
        children: {
          where: { status: 'deleted' },
          select: { id: true, status: true },
        },
      },
      orderBy: { updatedAt: 'desc' },
    })

    res.json(tasks)
  } catch (err) {
    next(err)
  }
})

// ─── DELETE /api/tasks/trash/empty ──────────────────────────────────────────

tasksRouter.delete('/trash/empty', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    await prisma.task.deleteMany({ where: { status: 'deleted' } })
    res.status(204).send()
  } catch (err) {
    next(err)
  }
})

// ─── GET /api/tasks/:id ──────────────────────────────────────────────────────

tasksRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const task = await prisma.task.findUnique({
      where: { id: req.params.id },
      include: {
        tags: { include: { tag: true } },
        reminders: true,
        parent: { select: { id: true, title: true, parentId: true } },
        children: {
          where: { status: { not: 'deleted' } },
          include: {
            tags: { include: { tag: true } },
            children: {
              where: { status: { not: 'deleted' } },
              select: { id: true, title: true, status: true, order: true },
            },
          },
          orderBy: { order: 'asc' },
        },
        list: { select: { id: true, name: true, icon: true, color: true } },
        section: { select: { id: true, name: true } },
      },
    })

    if (!task) {
      res.status(404).json({ error: 'Task not found' })
      return
    }

    res.json(task)
  } catch (err) {
    next(err)
  }
})

// ─── POST /api/tasks ─────────────────────────────────────────────────────────

tasksRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      title,
      description,
      parentId,
      listId,
      sectionId,
      priority,
      dueDate,
      dueTime,
      recurrence,
      order,
      tags,
    } = req.body

    if (!title || !listId) {
      res.status(400).json({ error: 'title and listId are required' })
      return
    }

    const task = await prisma.task.create({
      data: {
        title,
        description: description ?? '',
        parentId: parentId ?? null,
        listId,
        sectionId: sectionId ?? null,
        priority: priority ?? 'none',
        dueDate: dueDate ? new Date(dueDate) : null,
        dueTime: dueTime ?? null,
        recurrence: recurrence ?? null,
        order: order ?? 0,
        tags: tags?.length
          ? { create: (tags as string[]).map((tagId) => ({ tagId })) }
          : undefined,
      },
      include: DETAIL_INCLUDE,
    })

    res.status(201).json(task)
  } catch (err) {
    next(err)
  }
})

// ─── PUT /api/tasks/:id — full update ───────────────────────────────────────

tasksRouter.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      title,
      description,
      parentId,
      listId,
      sectionId,
      priority,
      dueDate,
      dueTime,
      recurrence,
      order,
      isPinned,
      tags,
    } = req.body

    const task = await prisma.$transaction(async (tx) => {
      if (tags !== undefined) {
        await tx.taskTag.deleteMany({ where: { taskId: req.params.id } })
      }

      return tx.task.update({
        where: { id: req.params.id },
        data: {
          ...(title !== undefined && { title }),
          ...(description !== undefined && { description }),
          ...(parentId !== undefined && { parentId }),
          ...(listId !== undefined && { listId }),
          ...(sectionId !== undefined && { sectionId }),
          ...(priority !== undefined && { priority }),
          ...(dueDate !== undefined && { dueDate: dueDate ? new Date(dueDate) : null }),
          ...(dueTime !== undefined && { dueTime }),
          ...(recurrence !== undefined && { recurrence }),
          ...(order !== undefined && { order }),
          ...(isPinned !== undefined && { isPinned }),
          ...(tags !== undefined && {
            tags: { create: (tags as string[]).map((tagId) => ({ tagId })) },
          }),
        },
        include: DETAIL_INCLUDE,
      })
    })

    res.json(task)
  } catch (err) {
    next(err)
  }
})

// ─── PATCH /api/tasks/:id/complete ──────────────────────────────────────────

tasksRouter.patch('/:id/complete', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.task.findUnique({
      where: { id: req.params.id },
      select: { status: true },
    })
    if (!existing) {
      res.status(404).json({ error: 'Task not found' })
      return
    }

    const isCompleting = existing.status !== 'completed'
    const task = await prisma.task.update({
      where: { id: req.params.id },
      data: {
        status: isCompleting ? 'completed' : 'active',
        completedAt: isCompleting ? new Date() : null,
      },
    })

    res.json(task)
  } catch (err) {
    next(err)
  }
})

// ─── PATCH /api/tasks/:id/wont-do ───────────────────────────────────────────

tasksRouter.patch('/:id/wont-do', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const task = await prisma.task.update({
      where: { id: req.params.id },
      data: { status: 'wont_do' },
    })
    res.json(task)
  } catch (err) {
    next(err)
  }
})

// ─── PATCH /api/tasks/:id/reorder ───────────────────────────────────────────

tasksRouter.patch('/:id/reorder', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { order, parentId, sectionId } = req.body
    const task = await prisma.task.update({
      where: { id: req.params.id },
      data: {
        ...(order !== undefined && { order }),
        ...(parentId !== undefined && { parentId }),
        ...(sectionId !== undefined && { sectionId }),
      },
    })
    res.json(task)
  } catch (err) {
    next(err)
  }
})

// ─── POST /api/tasks/:id/duplicate — single tree read + batched transaction ──

tasksRouter.post('/:id/duplicate', async (req: Request, res: Response, next: NextFunction) => {
  type NodeWithChildren = {
    id: string
    title: string
    description: string
    listId: string
    sectionId: string | null
    priority: string
    dueDate: Date | null
    dueTime: string | null
    recurrence: Prisma.JsonValue
    order: number
    tags: { tagId: string }[]
    children?: NodeWithChildren[]
  }

  // Fetch the entire subtree in a single query (up to 4 levels)
  const original = await prisma.task.findUnique({
    where: { id: req.params.id },
    include: {
      tags: true,
      children: {
        where: { status: { not: 'deleted' } },
        orderBy: { order: 'asc' },
        include: {
          tags: true,
          children: {
            where: { status: { not: 'deleted' } },
            orderBy: { order: 'asc' },
            include: {
              tags: true,
              children: {
                where: { status: { not: 'deleted' } },
                orderBy: { order: 'asc' },
                include: { tags: true },
              },
            },
          },
        },
      },
    },
  })

  if (!original) {
    res.status(404).json({ error: 'Task not found' })
    return
  }

  try {
    async function copyTree(
      src: NodeWithChildren,
      newParentId: string | null,
      tx: Prisma.TransactionClient,
    ): Promise<string> {
      const copy = await tx.task.create({
        data: {
          title: `${src.title} (copy)`,
          description: src.description,
          listId: src.listId,
          parentId: newParentId,
          sectionId: src.sectionId,
          priority: src.priority as import('@prisma/client').Priority,
          dueDate: src.dueDate,
          dueTime: src.dueTime,
          recurrence: src.recurrence ?? Prisma.DbNull,
          order: src.order + 0.5,
          tags: src.tags.length
            ? { create: src.tags.map((t) => ({ tagId: t.tagId })) }
            : undefined,
        },
      })

      for (const child of src.children ?? []) {
        await copyTree(child as NodeWithChildren, copy.id, tx)
      }

      return copy.id
    }

    const newId = await prisma.$transaction((tx) =>
      copyTree(original as unknown as NodeWithChildren, original.parentId, tx),
    )

    const task = await prisma.task.findUnique({
      where: { id: newId },
      include: { tags: { include: { tag: true } } },
    })
    res.status(201).json(task)
  } catch (err) {
    next(err)
  }
})

// ─── PATCH /api/tasks/:id/restore ───────────────────────────────────────────

tasksRouter.patch('/:id/restore', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const task = await prisma.task.update({
      where: { id: req.params.id },
      data: { status: 'active' },
      include: {
        tags: { include: { tag: true } },
        list: { select: { id: true, name: true, icon: true, color: true } },
      },
    })
    res.json(task)
  } catch (err) {
    next(err)
  }
})

// ─── DELETE /api/tasks/:id/permanent ────────────────────────────────────────

tasksRouter.delete('/:id/permanent', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await prisma.task.delete({ where: { id: req.params.id } })
    res.status(204).send()
  } catch (err) {
    next(err)
  }
})

// ─── DELETE /api/tasks/:id — soft delete ────────────────────────────────────

tasksRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await prisma.task.update({
      where: { id: req.params.id },
      data: { status: 'deleted' },
    })
    res.status(204).send()
  } catch (err) {
    next(err)
  }
})
