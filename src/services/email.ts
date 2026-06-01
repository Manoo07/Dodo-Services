import nodemailer from 'nodemailer'

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
})

// Email links go to the FRONTEND (GitHub Pages), not the backend.
// FRONTEND_URL may be comma-separated for CORS — take the first origin for links.
const FRONTEND_URL = (process.env.FRONTEND_URL || 'http://localhost:5173')
  .split(',')[0]
  .trim()

const FROM = `Dodo <${process.env.GMAIL_USER}>`

// ─── HTML layout helper ───────────────────────────────────────────────────────

function buildEmail(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${title}</title>
<style>
  body{margin:0;padding:0;background:#f4f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;}
  .wrap{max-width:520px;margin:48px auto;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.08);}
  .hd{background:#111113;padding:32px 40px;text-align:center;}
  .logo{font-size:22px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;}
  .logo span{color:#5b9bd5;}
  .bd{padding:40px;}
  h1{margin:0 0 12px;font-size:20px;font-weight:700;color:#111113;}
  p{margin:0 0 20px;font-size:15px;color:#4b5563;line-height:1.65;}
  .btn{display:inline-block;padding:13px 30px;background:#5b9bd5;color:#ffffff !important;text-decoration:none;border-radius:9px;font-size:15px;font-weight:600;letter-spacing:-0.1px;}
  .btn:hover{background:#6aaae0;}
  .note{margin-top:28px;font-size:12.5px;color:#9ca3af;line-height:1.6;}
  .note a{color:#5b9bd5;text-decoration:none;}
  .ft{padding:20px 40px 28px;text-align:center;font-size:12px;color:#9ca3af;border-top:1px solid #f0f0f2;}
</style>
</head>
<body>
<div class="wrap">
  <div class="hd"><div class="logo">Do<span>do</span></div></div>
  <div class="bd">${bodyHtml}</div>
  <div class="ft">© ${new Date().getFullYear()} Dodo · Your focused task manager</div>
</div>
</body>
</html>`
}

// ─── OTP verification email ───────────────────────────────────────────────────

export async function sendOtpEmail(to: string, name: string, otp: string): Promise<void> {
  await transporter.sendMail({
    from: FROM,
    to,
    subject: `${otp} is your Dodo verification code`,
    html: buildEmail(
      'Your verification code',
      `<h1>Verify your email, ${name}</h1>
       <p>Use the code below to complete your sign-up. It expires in <strong>5 minutes</strong>.</p>
       <div style="margin:28px 0;text-align:center;">
         <div style="display:inline-block;background:#111113;border:1px solid rgba(255,255,255,0.1);border-radius:14px;padding:20px 36px;">
           <span style="font-size:36px;font-weight:800;letter-spacing:10px;color:#ffffff;font-family:ui-monospace,monospace;">${otp}</span>
         </div>
       </div>
       <p class="note">This code is valid for <strong>5 minutes</strong> and can only be used once.<br/>If you didn't create a Dodo account, you can safely ignore this email.</p>`,
    ),
    text: `Hi ${name},\n\nYour Dodo verification code is: ${otp}\n\nExpires in 5 minutes.`,
  })
}

// ─── Password reset ───────────────────────────────────────────────────────────

export async function sendPasswordResetEmail(
  to: string,
  name: string,
  token: string,
): Promise<void> {
  const link = `${FRONTEND_URL}?reset=${token}`
  await transporter.sendMail({
    from: FROM,
    to,
    subject: 'Reset your Dodo password',
    html: buildEmail(
      'Reset your password',
      `<h1>Password reset request</h1>
       <p>Hi ${name}, we received a request to reset the password for your Dodo account. Click the button below to choose a new password.</p>
       <a href="${link}" class="btn">Reset my password</a>
       <p class="note">This link expires in <strong>1 hour</strong>. If you didn't request a password reset, please ignore this email — your account is safe.<br/>Or copy this URL: <a href="${link}">${link}</a></p>`,
    ),
    text: `Hi ${name},\n\nReset your Dodo password: ${link}\n\nExpires in 1 hour.`,
  })
}
