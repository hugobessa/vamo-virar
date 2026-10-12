import nodemailer from "nodemailer";

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
}

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

/** Any SMTP server: smtps://user:password@host:465 or smtp://user:password@host:587. */
export function smtpMailer(url: string, from: string): Mailer {
  const transport = nodemailer.createTransport(url);
  return {
    async send(m) {
      await transport.sendMail({ from, to: m.to, subject: m.subject, text: m.text, html: m.html, ...(m.replyTo ? { replyTo: m.replyTo } : {}) });
    },
  };
}

/** Development only: prints emails instead of sending them. They carry
 * creation codes, so never run a public portal like this. */
export function logMailer(): Mailer {
  return {
    async send(m) {
      console.log(`\n--- email para ${m.to}: ${m.subject}\n${m.text}\n---\n`);
    },
  };
}
