import nodemailer from 'nodemailer';
import { Resend } from 'resend';

export interface MailArgs {
  to: string;
  subject: string;
  html: string;
  attachments?: { filename: string; content: Buffer }[];
}

/**
 * One send function, two transports:
 *
 *   Gmail / Google Workspace — set GMAIL_USER + GMAIL_APP_PASSWORD. Sends
 *   through the firm's own mailbox (e.g. office@iluzlaw.com), so nothing new
 *   to sign up for and no DNS changes; the Workspace limit (~2,000/day) is
 *   far above anything a firm sends.
 *
 *   Resend — set RESEND_API_KEY (+ EMAIL_FROM on a verified domain).
 *
 * Gmail wins when both are configured, since it's the firm's real address.
 */
export async function sendMail(args: MailArgs): Promise<void> {
  const gmailUser = process.env.GMAIL_USER;
  const gmailPass = process.env.GMAIL_APP_PASSWORD;

  if (gmailUser && gmailPass) {
    const transport = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: gmailUser, pass: gmailPass },
    });
    await transport.sendMail({
      from: process.env.EMAIL_FROM || gmailUser,
      to: args.to,
      subject: args.subject,
      html: args.html,
      attachments: args.attachments,
    });
    return;
  }

  const key = process.env.RESEND_API_KEY;
  if (!key) {
    throw new Error(
      'No email transport configured — set GMAIL_USER + GMAIL_APP_PASSWORD (Google Workspace) or RESEND_API_KEY',
    );
  }
  const resend = new Resend(key);
  const { error } = await resend.emails.send({
    from: process.env.EMAIL_FROM || 'onboarding@resend.dev',
    to: args.to,
    subject: args.subject,
    html: args.html,
    attachments: args.attachments,
  });
  if (error) throw new Error(`Resend send failed: ${error.message ?? 'unknown error'}`);
}
