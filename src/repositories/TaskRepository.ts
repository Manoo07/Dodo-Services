import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import type { PaginationOptions, PaginationResult, TaskFilters } from '../types/index.js'
import { MAX_DEPTH } from '../types/index.js'

// ── Reusable Prisma include fragments ──────────────────────────────────────────

const CHILDREN_SUMMARY = {
  where: { status: { not: 'deleted' as const } },
  select: { id: true, status: true },
} satisfies Prisma.TaskInclude['children']

export const TASK_BASE_INCLUDE = {
  tags:    { include: { tag: true } },
  reminders: true,
  list:    { select: { id: true, name: true, icon: true, color: true } },
  section: { select: { id: true, name: true } },
} satisfies Prisma.TaskInclude

const TASK_DETAIL_INCLUDE = {
  tags:      { include: { tag: true } },
  reminders: true,
  children:  CHILDREN_SUMMARY,
} satisfies Prisma.TaskInclude

// ── Shared ownership filter ─────────────────────────────────────────────────────

const owned  = (userId: string): Prisma.TaskWhereInput => ({ list: { userId } })
const active = { status: { not: 'deleted' as const } }

// ── Repository ──────────────────────────────────────────────────────────────────

export class TaskRepository {

  // ─── Read (paginated) ──────────────────────────────────────────────────────

  /**
   * Paginate root tasks and load children up to MAX_DEPTH levels.
   * Returns a flat array so the client can reconstruct the tree cheaply.
   */
  async getPaginated(
    userId: string,
    { page, limit }: PaginationOptions,
  ): Promise<PaginationResult<object>> {
    const skip = page * limit

    const baseWhere: Prisma.TaskWhereInput = { ...owned(userId), ...active, parentId: null }

    const [total, rootTasks] = await Promise.all([
      prisma.task.count({ where: baseWhere }),
      prisma.task.findMany({
        where:    baseWhere,
        include:  TASK_BASE_INCLUDE,
        orderBy:  [{ isPinned: 'desc' }, { order: 'asc' }, { createdAt: 'asc' }],
        skip,
        take:     limit,
      }),
    ])

    if (rootTasks.length === 0) {
      return { data: [], total, page, hasMore: false }
    }

    // Batch-fetch children level by level (up to MAX_DEPTH)
    let parentIds = rootTasks.map((t) => t.id)
    const children: object[] = []

    for (let depth = 1; depth <= MAX_DEPTH; depth++) {
      if (parentIds.length === 0) break
      const level = await prisma.task.findMany({
        where:   { ...active, parentId: { in: parentIds } },
        include: TASK_BASE_INCLUDE,
        orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      })
      children.push(...level)
      parentIds = level.map((t) => t.id)
    }

    return {
      data:    [...rootTasks, ...children],
      total,
      page,
      hasMore: skip + limit < total,
    }
  }

  // ─── Read (filtered) ───────────────────────────────────────────────────────

  async findByFilters(userId: string, filters: TaskFilters) {
    const where: Prisma.TaskWhereInput = {
      ...owned(userId),
      ...active,
      ...(filters.listId   && { listId:   filters.listId }),
      ...(filters.status   && { status:   filters.status   as Prisma.EnumTaskStatusFilter }),
      ...(filters.priority && { priority: filters.priority as Prisma.EnumPriorityFilter  }),
      ...(filters.tag      && { tags: { some: { tag: { name: filters.tag } } } }),
      parentId: filters.parentId !== undefined ? filters.parentId : null,
    }

    return prisma.task.findMany({
      where,
      include: { ...TASK_DETAIL_INCLUDE, section: { select: { id: true, name: true } } },
      orderBy: [{ isPinned: 'desc' }, { order: 'asc' }, { createdAt: 'asc' }],
    })
  }

  async findById(id: string, userId: string) {
    return prisma.task.findFirst({
      where:   { id, ...owned(userId) },
      include: {
        tags:      { include: { tag: true } },
        reminders: true,
        parent:    { select: { id: true, title: true, parentId: true } },
        children: {
          where:   active,
          include: {
            tags: { include: { tag: true } },
            children: { where: active, select: { id: true, title: true, status: true, order: true } },
          },
          orderBy: { order: 'asc' },
        },
        list:    { select: { id: true, name: true, icon: true, color: true } },
        section: { select: { id: true, name: true } },
      },
    })
  }

  async findByDateRange(userId: string, from: Date, to: Date) {
    return prisma.task.findMany({
      where:   { ...owned(userId), ...active, dueDate: { gte: from, lte: to } },
      include: TASK_BASE_INCLUDE,
      orderBy: [{ isPinned: 'desc' }, { priority: 'asc' }, { order: 'asc' }],
    })
  }

  async findOverdue(userId: string, before: Date) {
    return prisma.task.findMany({
      where:   { ...owned(userId), status: 'active', dueDate: { lt: before } },
      include: TASK_BASE_INCLUDE,
      orderBy: { dueDate: 'asc' },
    })
  }

  async findInbox(userId: string) {
    return prisma.task.findMany({
      where:   { ...owned(userId), ...active, list: { userId, name: { equals: 'Inbox', mode: 'insensitive' } }, parentId: null },
      include: TASK_BASE_INCLUDE,
      orderBy: [{ isPinned: 'desc' }, { order: 'asc' }],
    })
  }

  async findTrashed(userId: string) {
    return prisma.task.findMany({
      where:   { ...owned(userId), status: 'deleted' },
      include: { ...TASK_BASE_INCLUDE, children: { where: { status: 'deleted' }, select: { id: true, status: true } } },
      orderBy: { updatedAt: 'desc' },
    })
  }

  async search(userId: string, q: string, extras?: Partial<TaskFilters>) {
    return prisma.task.findMany({
      where: {
        AND: [
          owned(userId),
          active,
          {
            OR: [
              { title:       { contains: q, mode: 'insensitive' } },
              { description: { contains: q, mode: 'insensitive' } },
              { tags: { some: { tag: { name: { contains: q, mode: 'insensitive' } } } } },
            ],
          },
          ...(extras?.listId   ? [{ listId:   extras.listId                                    }] : []),
          ...(extras?.tag      ? [{ tags: { some: { tag: { name: extras.tag } } } }]              : []),
          ...(extras?.priority ? [{ priority:  extras.priority as Prisma.EnumPriorityFilter  }]  : []),
          ...(extras?.status   ? [{ status:    extras.status   as Prisma.EnumTaskStatusFilter }]  : []),
        ],
      },
      include: { tags: { include: { tag: true } }, list: { select: { id: true, name: true, icon: true, color: true } }, section: { select: { id: true, name: true } } },
      orderBy: { updatedAt: 'desc' },
      take:    50,
    })
  }

  // ─── Ownership check ───────────────────────────────────────────────────────

  async assertOwned(id: string, userId: string): Promise<boolean> {
    const t = await prisma.task.findFirst({ where: { id, ...owned(userId) }, select: { id: true } })
    return !!t
  }

  // ─── Mutations ─────────────────────────────────────────────────────────────

  async create(data: Prisma.TaskCreateInput) {
    return prisma.task.create({ data, include: TASK_DETAIL_INCLUDE })
  }

  async update(id: string, data: Prisma.TaskUpdateInput) {
    return prisma.task.update({ where: { id }, data, include: TASK_DETAIL_INCLUDE })
  }

  async updateMany(where: Prisma.TaskWhereInput, data: Prisma.TaskUpdateInput) {
    return prisma.task.updateMany({ where, data })
  }

  async softDelete(id: string, userId: string) {
    return prisma.task.updateMany({ where: { id, ...owned(userId) }, data: { status: 'deleted' } })
  }

  async restore(id: string, userId: string) {
    const result = await prisma.task.updateMany({
      where: { id, ...owned(userId) },
      data:  { status: 'active' },
    })
    if (!result.count) return null
    return this.findById(id, userId)
  }

  async hardDelete(id: string, userId: string) {
    return prisma.task.deleteMany({ where: { id, ...owned(userId) } })
  }

  async emptyTrash(userId: string) {
    return prisma.task.deleteMany({ where: { ...owned(userId), status: 'deleted' } })
  }

  async reorder(id: string, userId: string, order: number, parentId?: string | null, sectionId?: string | null) {
    if (!(await this.assertOwned(id, userId))) return null
    return prisma.task.update({
      where: { id },
      data: {
        ...(order     !== undefined && { order }),
        ...(parentId  !== undefined && { parentId }),
        ...(sectionId !== undefined && { sectionId }),
      },
    })
  }

  async duplicate(taskId: string, userId: string): Promise<string | null> {
    type Node = { id: string; title: string; description: string; listId: string; sectionId: string | null; priority: string; dueDate: Date | null; dueTime: string | null; recurrence: Prisma.JsonValue; order: number; tags: { tagId: string }[]; children?: Node[] }

    const original = await prisma.task.findFirst({
      where:   { id: taskId, ...owned(userId) },
      include: { tags: true, children: { where: active, orderBy: { order: 'asc' }, include: { tags: true, children: { where: active, orderBy: { order: 'asc' }, include: { tags: true } } } } },
    })
    if (!original) return null

    const copyTree = async (src: Node, newParentId: string | null, tx: Prisma.TransactionClient): Promise<string> => {
      const copy = await tx.task.create({
        data: {
          title:     `${src.title} (copy)`,
          description: src.description,
          listId:    src.listId,
          parentId:  newParentId,
          sectionId: src.sectionId,
          priority:  src.priority as import('@prisma/client').Priority,
          dueDate:   src.dueDate,
          dueTime:   src.dueTime,
          recurrence: src.recurrence ?? Prisma.DbNull,
          order:     src.order + 0.5,
          tags:      src.tags.length ? { create: src.tags.map((t) => ({ tagId: t.tagId })) } : undefined,
        },
      })
      for (const child of src.children ?? []) await copyTree(child as Node, copy.id, tx)
      return copy.id
    }

    return prisma.$transaction((tx) => copyTree(original as unknown as Node, original.parentId, tx))
  }
}

export const taskRepository = new TaskRepository()
