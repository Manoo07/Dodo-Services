import type { Request, Response, NextFunction } from 'express'
import { Prisma } from '@prisma/client'

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
) {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2025') {
      res.status(404).json({ error: 'Record not found' })
      return
    }
    if (err.code === 'P2002') {
      res.status(409).json({ error: 'A record with this value already exists' })
      return
    }
  }

  console.error(err.stack ?? err.message)
  const status = (err as { status?: number }).status ?? 500
  res.status(status).json({ error: err.message || 'Internal server error' })
}

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: 'Route not found' })
}
