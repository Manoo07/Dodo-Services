import crypto from 'crypto'
import bcrypt from 'bcryptjs'   // only used by auth service — kept here as example
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { taskRepository } from '../repositories/TaskRepository.js'
import type { PaginationOptions, TaskFilters } from '../types/index.js'

// ── Service — orchestrates repository calls and applies business rules ─────────

export class TaskService {

  // ─── Read ──────────────────────────────────────────────────────────────────

  getAllPaginated(userId: string, opts: PaginationOptions) {
    return taskRepository.getPaginated(userId, opts)
  }

  getFiltered(userId: string, filters: TaskFilters) {
    return taskRepository.findByFilters(userId, filters)
  }

  async getById(id: string, userId: string) {
    const task = await taskRepository.findById(id, userId)
    if (!task) throw new NotFoundError('Task not found')
    return task
  }

  getToday(userId: string) {
    const now  = new Date()
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const to   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)
    return taskRepository.findByDateRange(userId, from, to)
  }

  getNext7Days(userId: string) {
    const now  = new Date()
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const to   = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7, 23, 59, 59, 999)
    return taskRepository.findByDateRange(userId, from, to)
  }

  getOverdue(userId: string) {
    const startOfToday = new Date()
    startOfToday.setHours(0, 0, 0, 0)
    return taskRepository.findOverdue(userId, startOfToday)
  }

  getInbox(userId: string)  { return taskRepository.findInbox(userId) }
  getTrashed(userId: string){ return taskRepository.findTrashed(userId) }

  search(userId: string, q: string, filters?: Partial<TaskFilters>) {
    return taskRepository.search(userId, q, filters)
  }

  // ─── Mutations ─────────────────────────────────────────────────────────────

  create(userId: string, data: {
    title: string; listId: string; description?: string; parentId?: string | null
    sectionId?: string | null; priority?: string; dueDate?: string | null; dueTime?: string | null
    recurrence?: unknown; order?: number; tags?: string[]
  }) {
    // Business rule: validate that the target list belongs to this user
    return taskRepository.create({
      title:       data.title,
      description: data.description ?? '',
      parent:      data.parentId ? { connect: { id: data.parentId } } : undefined,
      list:        { connect: { id: data.listId } },
      section:     data.sectionId ? { connect: { id: data.sectionId } } : undefined,
      priority:    (data.priority ?? 'none') as import('@prisma/client').Priority,
      dueDate:     data.dueDate   ? new Date(data.dueDate) : null,
      dueTime:     data.dueTime   ?? null,
      recurrence:  data.recurrence as Prisma.InputJsonValue ?? Prisma.DbNull,
      order:       data.order     ?? 0,
      tags:        data.tags?.length
        ? { create: data.tags.map((tagId) => ({ tagId })) }
        : undefined,
    })
  }

  async update(id: string, userId: string, data: {
    title?: string; description?: string; parentId?: string; listId?: string
    sectionId?: string; priority?: string; dueDate?: string | null; dueTime?: string
    recurrence?: unknown; order?: number; isPinned?: boolean; tags?: string[]
  }) {
    if (!(await taskRepository.assertOwned(id, userId))) throw new NotFoundError('Task not found')

    // If tags are being replaced, delete old ones first (in a transaction)
    if (data.tags !== undefined) {
      await prisma.$transaction(async (tx) => {
        await tx.taskTag.deleteMany({ where: { taskId: id } })
        return tx.task.update({
          where: { id },
          data: {
            ...(data.title       !== undefined && { title:       data.title }),
            ...(data.description !== undefined && { description: data.description }),
            ...(data.parentId    !== undefined && { parentId:    data.parentId }),
            ...(data.listId      !== undefined && { listId:      data.listId }),
            ...(data.sectionId   !== undefined && { sectionId:   data.sectionId }),
            ...(data.priority    !== undefined && { priority:    data.priority as import('@prisma/client').Priority }),
            ...(data.dueDate     !== undefined && { dueDate:     data.dueDate ? new Date(data.dueDate) : null }),
            ...(data.dueTime     !== undefined && { dueTime:     data.dueTime }),
            ...(data.recurrence  !== undefined && { recurrence:  data.recurrence as Prisma.InputJsonValue }),
            ...(data.order       !== undefined && { order:       data.order }),
            ...(data.isPinned    !== undefined && { isPinned:    data.isPinned }),
            tags: { create: data.tags!.map((tagId) => ({ tagId })) },
          },
        })
      })
      return taskRepository.findById(id, userId)
    }

    return taskRepository.update(id, {
      ...(data.title       !== undefined && { title:       data.title }),
      ...(data.description !== undefined && { description: data.description }),
      ...(data.parentId    !== undefined && { parentId:    data.parentId }),
      ...(data.listId      !== undefined && { listId:      data.listId }),
      ...(data.sectionId   !== undefined && { sectionId:   data.sectionId }),
      ...(data.priority    !== undefined && { priority:    data.priority as import('@prisma/client').Priority }),
      ...(data.dueDate     !== undefined && { dueDate:     data.dueDate ? new Date(data.dueDate) : null }),
      ...(data.dueTime     !== undefined && { dueTime:     data.dueTime }),
      ...(data.recurrence  !== undefined && { recurrence:  data.recurrence as Prisma.InputJsonValue }),
      ...(data.order       !== undefined && { order:       data.order }),
      ...(data.isPinned    !== undefined && { isPinned:    data.isPinned }),
    })
  }

  async toggleComplete(id: string, userId: string) {
    const task = await prisma.task.findFirst({ where: { id, list: { userId } }, select: { status: true } })
    if (!task) throw new NotFoundError('Task not found')
    const completing = task.status !== 'completed'
    return taskRepository.update(id, {
      status:      completing ? 'completed' : 'active',
      completedAt: completing ? new Date()  : null,
    })
  }

  async markWontDo(id: string, userId: string) {
    if (!(await taskRepository.assertOwned(id, userId))) throw new NotFoundError('Task not found')
    return taskRepository.update(id, { status: 'wont_do' })
  }

  async reorder(id: string, userId: string, order: number, parentId?: string | null, sectionId?: string | null) {
    const task = await taskRepository.reorder(id, userId, order, parentId, sectionId)
    if (!task) throw new NotFoundError('Task not found')
    return task
  }

  async duplicate(id: string, userId: string) {
    const newId = await taskRepository.duplicate(id, userId)
    if (!newId) throw new NotFoundError('Task not found')
    return prisma.task.findUnique({ where: { id: newId }, include: { tags: { include: { tag: true } } } })
  }

  async restore(id: string, userId: string) {
    const task = await taskRepository.restore(id, userId)
    if (!task) throw new NotFoundError('Task not found')
    return task
  }

  async softDelete(id: string, userId: string) {
    const result = await taskRepository.softDelete(id, userId)
    if (!result.count) throw new NotFoundError('Task not found')
  }

  async hardDelete(id: string, userId: string) {
    const result = await taskRepository.hardDelete(id, userId)
    if (!result.count) throw new NotFoundError('Task not found')
  }

  emptyTrash(userId: string) { return taskRepository.emptyTrash(userId) }
}

// ── Domain errors (loosely coupled from HTTP) ──────────────────────────────────

export class NotFoundError  extends Error { constructor(msg: string) { super(msg); this.name = 'NotFoundError'  } }
export class ForbiddenError extends Error { constructor(msg: string) { super(msg); this.name = 'ForbiddenError' } }
export class ValidationError extends Error { constructor(msg: string) { super(msg); this.name = 'ValidationError' } }

export const taskService = new TaskService()
