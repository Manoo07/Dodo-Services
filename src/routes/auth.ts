import { Router } from 'express'
import type { Request, Response, NextFunction } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import { prisma } from '../lib/prisma.js'
import { requireAuth, type AuthRequest } from '../middleware/requireAuth.js'
import { sendOtpEmail, sendPasswordResetEmail } from '../services/email.js'

export const authRouter = Router()

const SALT_ROUNDS = 12
const JWT_EXPIRES = '30d'
const RESET_EXPIRES_MS = 60 * 60 * 1000   // 1 hour
const OTP_EXPIRES_MS   = 5  * 60 * 1000   // 5 minutes

function generateOtp(): string {
  return (crypto.randomInt(900_000) + 100_000).toString()
}

function signToken(userId: string): string {
  return jwt.sign({ userId }, process.env.JWT_SECRET!, { expiresIn: JWT_EXPIRES })
}

function safeUser(user: { id: string; email: string; name: string; emailVerified: boolean; createdAt: Date; digestHour: number; digestTimezoneOffset: number }) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    emailVerified: user.emailVerified,
    createdAt: user.createdAt,
    digestHour: user.digestHour,
    digestTimezoneOffset: user.digestTimezoneOffset,
  }
}

// ─── POST /api/auth/register ──────────────────────────────────────────────────

authRouter.post('/register', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, email, password } = req.body

    if (!name?.trim() || !email?.trim() || !password) {
      res.status(400).json({ error: 'name, email and password are required' })
      return
    }
    if (password.length < 8) {
      res.status(400).json({ error: 'Password must be at least 8 characters' })
      return
    }

    const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } })
    if (existing) {
      res.status(409).json({ error: 'An account with this email already exists' })
      return
    }

    const hashed = await bcrypt.hash(password, SALT_ROUNDS)
    const otp      = generateOtp()
    const otpExpiry = new Date(Date.now() + OTP_EXPIRES_MS)

    const user = await prisma.user.create({
      data: {
        name: name.trim(),
        email: email.toLowerCase().trim(),
        password: hashed,
        otp,
        otpExpiry,
      },
    })

    await prisma.list.create({
      data: { name: 'Inbox', icon: '📥', color: '#636366', order: 0, userId: user.id },
    })

    sendOtpEmail(user.email, user.name, otp).catch((err) => {
      console.error('Failed to send OTP email:', err)
    })

    // No token returned — user must enter OTP first
    res.status(201).json({ user: safeUser(user) })
  } catch (err) {
    next(err)
  }
})

// ─── POST /api/auth/login ─────────────────────────────────────────────────────

authRouter.post('/login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = req.body

    if (!email?.trim() || !password) {
      res.status(400).json({ error: 'email and password are required' })
      return
    }

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } })
    if (!user) {
      res.status(401).json({ error: 'Invalid email or password' })
      return
    }

    const valid = await bcrypt.compare(password, user.password)
    if (!valid) {
      res.status(401).json({ error: 'Invalid email or password' })
      return
    }

    if (!user.emailVerified) {
      res.status(403).json({
        error: 'Please verify your email before signing in.',
        code: 'EMAIL_NOT_VERIFIED',
        email: user.email,
      })
      return
    }

    const token = signToken(user.id)
    res.json({ user: safeUser(user), token })
  } catch (err) {
    next(err)
  }
})

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────

authRouter.get('/me', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as AuthRequest).userId
    const user = await prisma.user.findUnique({ where: { id: userId } })
    if (!user) {
      res.status(404).json({ error: 'User not found' })
      return
    }
    res.json(safeUser(user))
  } catch (err) {
    next(err)
  }
})

// ─── POST /api/auth/verify-email ─────────────────────────────────────────────

authRouter.post('/verify-email', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, otp } = req.body
    if (!email?.trim() || !otp?.trim()) {
      res.status(400).json({ error: 'email and otp are required' })
      return
    }

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } })

    if (!user || user.otp !== otp.trim()) {
      res.status(400).json({ error: 'Invalid verification code' })
      return
    }

    if (!user.otpExpiry || user.otpExpiry < new Date()) {
      res.status(400).json({ error: 'Verification code has expired. Please request a new one.' })
      return
    }

    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: { emailVerified: true, otp: null, otpExpiry: null },
    })

    // Issue a token so the user is immediately signed in after verification
    const token = signToken(user.id)
    res.json({ user: safeUser(updatedUser), token, message: 'Email verified! Welcome to Dodo.' })
  } catch (err) {
    next(err)
  }
})

// ─── PATCH /api/auth/preferences ─────────────────────────────────────────────

authRouter.patch('/preferences', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as AuthRequest).userId
    const { digestHour } = req.body

    if (digestHour !== undefined) {
      const h = Number(digestHour)
      if (!Number.isInteger(h) || h < 0 || h > 23) {
        res.status(400).json({ error: 'digestHour must be an integer 0–23 (UTC)' })
        return
      }
    }

    const { digestTimezoneOffset } = req.body
    if (digestTimezoneOffset !== undefined) {
      const off = Number(digestTimezoneOffset)
      if (!Number.isInteger(off) || off < -840 || off > 840) {
        res.status(400).json({ error: 'digestTimezoneOffset must be minutes between -840 and 840' })
        return
      }
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data: {
        ...(digestHour !== undefined && { digestHour: Number(digestHour) }),
        ...(digestTimezoneOffset !== undefined && { digestTimezoneOffset: Number(digestTimezoneOffset) }),
      },
    })

    res.json(safeUser(user))
  } catch (err) {
    next(err)
  }
})

// ─── POST /api/auth/resend-verification ──────────────────────────────────────

authRouter.post('/resend-verification', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email } = req.body
    if (!email?.trim()) {
      res.status(400).json({ error: 'email is required' })
      return
    }

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } })

    if (user && !user.emailVerified) {
      const otp = generateOtp()
      const otpExpiry = new Date(Date.now() + OTP_EXPIRES_MS)
      await prisma.user.update({ where: { id: user.id }, data: { otp, otpExpiry } })
      sendOtpEmail(user.email, user.name, otp).catch((err) => {
        console.error('Failed to resend OTP email:', err)
      })
    }

    // Always return the same message to prevent user enumeration
    res.json({ message: 'A new verification link has been sent if your email is registered and unverified.' })
  } catch (err) {
    next(err)
  }
})

// ─── POST /api/auth/forgot-password ──────────────────────────────────────────

authRouter.post('/forgot-password', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email } = req.body
    if (!email?.trim()) {
      res.status(400).json({ error: 'email is required' })
      return
    }

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } })

    // Always respond the same way to prevent user enumeration
    if (user) {
      const resetToken = crypto.randomBytes(32).toString('hex')
      const resetTokenExp = new Date(Date.now() + RESET_EXPIRES_MS)

      await prisma.user.update({
        where: { id: user.id },
        data: { resetToken, resetTokenExp },
      })

      sendPasswordResetEmail(user.email, user.name, resetToken).catch((err) => {
        console.error('Failed to send reset email:', err)
      })
    }

    res.json({ message: 'If an account exists for this email, a reset link has been sent.' })
  } catch (err) {
    next(err)
  }
})

// ─── POST /api/auth/reset-password ───────────────────────────────────────────

authRouter.post('/reset-password', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { token, password } = req.body
    if (!token || !password) {
      res.status(400).json({ error: 'token and password are required' })
      return
    }
    if (password.length < 8) {
      res.status(400).json({ error: 'Password must be at least 8 characters' })
      return
    }

    const user = await prisma.user.findUnique({ where: { resetToken: token } })
    if (!user || !user.resetTokenExp || user.resetTokenExp < new Date()) {
      res.status(400).json({ error: 'Invalid or expired reset link' })
      return
    }

    const hashed = await bcrypt.hash(password, SALT_ROUNDS)
    await prisma.user.update({
      where: { id: user.id },
      data: { password: hashed, resetToken: null, resetTokenExp: null },
    })

    res.json({ message: 'Password reset successfully. You can now log in.' })
  } catch (err) {
    next(err)
  }
})
