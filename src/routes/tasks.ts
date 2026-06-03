import { Router } from 'express'
import type { Request, Response, NextFunction } from 'express'
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { requireAuth, type AuthRequest } from '../middleware/requireAuth.js'

export const tasksRouter = Router()

tasksRouter.use(requireAuth)

/** Extract the authenticated user's ID from the request */
const uid = (req: Request) => (req as AuthRequest).userId

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
      list: { userId: uid(req) },         // ← ownership
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

// ─── GET /api/tasks/all — paginated flat list with 3-level depth cap ─────────
//
// Query params:
//   page  (default 0) — which page of ROOT tasks to return
//   limit (default 20, max 50) — root tasks per page
//
// Strategy: fetch paginated ROOT tasks, then batch-fetch up to 3 levels of
// children.  All levels are combined into a single flat array so the client
// can build trees with the existing client-side logic.

tasksRouter.get('/all', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page  = Math.max(0, parseInt(String(req.query.page  ?? 0),  10) || 0)
    const limit = Math.min(50, parseInt(String(req.query.limit ?? 20), 10) || 20)
    const skip  = page * limit

    const userWhere = { list: { userId: uid(req) } }
    const notDeleted = { status: { not: 'deleted' as const } }

    const TASK_INCLUDE = {
      tags:    { include: { tag: true } },
      reminders: true,
      list:    { select: { id: true, name: true, icon: true, color: true } },
      section: { select: { id: true, name: true } },
    } satisfies Prisma.TaskInclude

    // ── Level 0: paginated root tasks ──────────────────────────────────────────
    const [total, rootTasks] = await Promise.all([
      prisma.task.count({ where: { ...userWhere, ...notDeleted, parentId: null } }),
      prisma.task.findMany({
        where: { ...userWhere, ...notDeleted, parentId: null },
        include: TASK_INCLUDE,
        orderBy: [{ isPinned: 'desc' }, { order: 'asc' }, { createdAt: 'asc' }],
        skip,
        take: limit,
      }),
    ])

    if (rootTasks.length === 0) {
      res.json({ tasks: [], total, page, hasMore: false })
      return
    }

    // ── Level 1: direct children of roots ──────────────────────────────────────
    const rootIds  = rootTasks.map((t) => t.id)
    const level1   = await prisma.task.findMany({
      where: { ...notDeleted, parentId: { in: rootIds } },
      include: TASK_INCLUDE,
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    })

    // ── Level 2: grandchildren ─────────────────────────────────────────────────
    const l1Ids    = level1.map((t) => t.id)
    const level2   = l1Ids.length
      ? await prisma.task.findMany({
          where: { ...notDeleted, parentId: { in: l1Ids } },
          include: TASK_INCLUDE,
          orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
        })
      : []

    // ── Level 3: great-grandchildren ───────────────────────────────────────────
    const l2Ids    = level2.map((t) => t.id)
    const level3   = l2Ids.length
      ? await prisma.task.findMany({
          where: { ...notDeleted, parentId: { in: l2Ids } },
          include: TASK_INCLUDE,
          orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
        })
      : []

    res.json({
      tasks:   [...rootTasks, ...level1, ...level2, ...level3],
      total,
      page,
      hasMore: skip + limit < total,
    })
  } catch (err) {
    next(err)
  }
})

// ─── GET /api/tasks/today ────────────────────────────────────────────────────

tasksRouter.get('/today', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const now = new Date()
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)

    const tasks = await prisma.task.findMany({
      where: {
        list: { userId: uid(req) },        // ← ownership
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

tasksRouter.get('/next7days', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const now = new Date()
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7, 23, 59, 59, 999)

    const tasks = await prisma.task.findMany({
      where: {
        list: { userId: uid(req) },        // ← ownership
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

tasksRouter.get('/overdue', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const startOfToday = new Date()
    startOfToday.setHours(0, 0, 0, 0)

    const tasks = await prisma.task.findMany({
      where: {
        list: { userId: uid(req) },        // ← ownership
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

// ─── GET /api/tasks/inbox ────────────────────────────────────────────────────

tasksRouter.get('/inbox', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tasks = await prisma.task.findMany({
      where: {
        list: { userId: uid(req), name: { equals: 'Inbox', mode: 'insensitive' } },  // ← ownership
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
          { list: { userId: uid(req) } },  // ← ownership
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

tasksRouter.get('/trash', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tasks = await prisma.task.findMany({
      where: {
        list: { userId: uid(req) },        // ← ownership
        status: 'deleted',
      },
      include: {
        tags: { include: { tag: true } },
        list: { select: { id: true, name: true, icon: true, color: true } },
        children: { where: { status: 'deleted' }, select: { id: true, status: true } },
      },
      orderBy: { updatedAt: 'desc' },
    })

    res.json(tasks)
  } catch (err) {
    next(err)
  }
})

// ─── DELETE /api/tasks/trash/empty ──────────────────────────────────────────

tasksRouter.delete('/trash/empty', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await prisma.task.deleteMany({
      where: {
        list: { userId: uid(req) },        // ← ownership: only wipe THIS user's trash
        status: 'deleted',
      },
    })
    res.status(204).send()
  } catch (err) {
    next(err)
  }
})

// ─── GET /api/tasks/:id ──────────────────────────────────────────────────────

tasksRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const task = await prisma.task.findFirst({   // findFirst allows compound where
      where: { id: req.params.id, list: { userId: uid(req) } },  // ← ownership
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

    // Verify the target list belongs to this user
    const list = await prisma.list.findFirst({ where: { id: String(listId), userId: uid(req) } })
    if (!list) {
      res.status(403).json({ error: 'List not found or access denied' })
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

    // Ownership check
    const owned = await prisma.task.findFirst({
      where: { id: req.params.id, list: { userId: uid(req) } },
      select: { id: true },
    })
    if (!owned) { res.status(404).json({ error: 'Task not found' }); return }

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
    const existing = await prisma.task.findFirst({
      where: { id: req.params.id, list: { userId: uid(req) } },  // ← ownership
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
    const owned = await prisma.task.findFirst({
      where: { id: req.params.id, list: { userId: uid(req) } },
      select: { id: true },
    })
    if (!owned) { res.status(404).json({ error: 'Task not found' }); return }

    const task = await prisma.task.update({ where: { id: req.params.id }, data: { status: 'wont_do' } })
    res.json(task)
  } catch (err) {
    next(err)
  }
})

// ─── PATCH /api/tasks/:id/reorder ───────────────────────────────────────────

tasksRouter.patch('/:id/reorder', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const owned = await prisma.task.findFirst({
      where: { id: req.params.id, list: { userId: uid(req) } },
      select: { id: true },
    })
    if (!owned) { res.status(404).json({ error: 'Task not found' }); return }

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

  // Ownership check + fetch the entire subtree in a single query (up to 4 levels)
  const original = await prisma.task.findFirst({
    where: { id: req.params.id, list: { userId: uid(req) } },
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
    const owned = await prisma.task.findFirst({
      where: { id: req.params.id, list: { userId: uid(req) } },
      select: { id: true },
    })
    if (!owned) { res.status(404).json({ error: 'Task not found' }); return }

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
    const result = await prisma.task.deleteMany({
      where: { id: req.params.id, list: { userId: uid(req) } },  // ← ownership
    })
    if (result.count === 0) { res.status(404).json({ error: 'Task not found' }); return }
    res.status(204).send()
  } catch (err) {
    next(err)
  }
})

// ─── DELETE /api/tasks/:id — soft delete ────────────────────────────────────

tasksRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await prisma.task.updateMany({
      where: { id: req.params.id, list: { userId: uid(req) } },  // ← ownership
      data: { status: 'deleted' },
    })
    if (result.count === 0) { res.status(404).json({ error: 'Task not found' }); return }
    res.status(204).send()
  } catch (err) {
    next(err)
  }
})
