import { Injectable, Logger, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { EmailOutboxKind } from '@prisma/client';
import type { EmailPayload } from './mail-crypto';

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

@Injectable()
export class MailService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MailService.name);
  private transporter?: Transporter;
  private lastVerifiedAt?: Date;
  private lastFailure?: string;
  private useResend = false;

  async onModuleInit() {
    const transport = process.env.EMAIL_TRANSPORT || 'smtp';
    if (!['smtp', 'resend'].includes(transport)) throw new Error('EMAIL_TRANSPORT must be smtp or resend');
    if (transport === 'resend') {
      if (!process.env.RESEND_API_KEY || !process.env.SMTP_FROM) {
        this.lastFailure = 'EMAIL_API_NOT_CONFIGURED';
        this.logger.warn('Resend email API is not configured; email delivery is unavailable');
        return;
      }
      this.useResend = true;
      this.lastFailure = undefined;
      return;
    }
    const { SMTP_HOST, SMTP_USER, SMTP_PASSWORD, SMTP_FROM } = process.env;
    const port = Number(process.env.SMTP_PORT || 465);
    const localMailpit = ['localhost', '127.0.0.1', 'mailpit'].includes(SMTP_HOST || '') && port === 1025;
    if (!SMTP_HOST || !SMTP_FROM || (!localMailpit && (!SMTP_USER || !SMTP_PASSWORD))) {
      this.lastFailure = 'SMTP_NOT_CONFIGURED';
      this.logger.warn('SMTP is not configured; email delivery is unavailable');
      return;
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535 || (process.env.SMTP_SECURE && !['true', 'false'].includes(process.env.SMTP_SECURE))) {
      this.lastFailure = 'SMTP_INVALID_CONFIG';
      this.logger.warn('Invalid SMTP_PORT or SMTP_SECURE configuration');
      return;
    }
    this.transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port,
      secure: process.env.SMTP_SECURE !== 'false',
      ...(!localMailpit && process.env.SMTP_SECURE === 'false' ? { requireTLS: true } : {}),
      ...(SMTP_USER && SMTP_PASSWORD ? { auth: { user: SMTP_USER, pass: SMTP_HOST === 'smtp.gmail.com' ? SMTP_PASSWORD.replace(/\s/g, '') : SMTP_PASSWORD } } : {}),
      connectionTimeout: Number(process.env.SMTP_CONNECTION_TIMEOUT || 10_000),
      greetingTimeout: Number(process.env.SMTP_GREETING_TIMEOUT || 10_000),
      socketTimeout: Number(process.env.SMTP_SOCKET_TIMEOUT || 20_000),
      pool: true,
      maxConnections: 3,
      maxMessages: 100,
    });
    await this.verifyConnection();
  }

  async onModuleDestroy() { this.transporter?.close(); }

  async verifyConnection() {
    if (!this.transporter) return { status: 'unavailable' as const };
    try {
      await this.transporter.verify();
      this.lastVerifiedAt = new Date();
      this.lastFailure = undefined;
      return { status: 'ok' as const, verifiedAt: this.lastVerifiedAt };
    } catch (error) {
      this.lastFailure = this.safeFailure(error);
      this.logger.error(`SMTP health check failed (${this.lastFailure})`);
      return { status: 'unavailable' as const };
    }
  }

  health() {
    const status = this.lastFailure ? 'unavailable' : this.lastVerifiedAt ? 'ok' : this.useResend ? 'configured' : 'unknown';
    return { provider: this.useResend ? 'resend' : 'smtp', status, lastVerifiedAt: this.lastVerifiedAt, ...(this.lastFailure ? { reason: this.lastFailure } : {}) };
  }

  private safeFailure(error: unknown) {
    const code = (error as { code?: unknown } | null)?.code;
    return typeof code === 'string' && ['EAUTH', 'ECONNECTION', 'ESOCKET', 'ETIMEDOUT', 'EDNS', 'EENVELOPE', 'EMESSAGE', 'EMAIL_API_ERROR'].includes(code) ? code : 'SMTP_ERROR';
  }

  async send(kind: EmailOutboxKind, payload: EmailPayload, messageId: string) {
    const { SMTP_FROM, SMTP_FROM_NAME } = process.env;
    if ((!this.transporter && !this.useResend) || !SMTP_FROM) throw new ServiceUnavailableException({ code: 'EMAIL_DELIVERY_FAILED', message: 'Отправка email не настроена. Проверьте SMTP-конфигурацию.' });
    const isReset = kind === EmailOutboxKind.RESET_PASSWORD;
    const code = escapeHtml(payload.code);
    const product = 'gloomi';
    try {
    const subject = isReset ? 'Reset your gloomi password' : 'Your gloomi verification code';
    const text = isReset ? `Your password reset code is ${payload.code}. It expires in 10 minutes.` : `Your gloomi code is ${payload.code}. It expires in 10 minutes.`;
    const html = isReset
      ? `<p>Use this code to reset your password:</p><strong style="font-size:28px;letter-spacing:8px">${code}</strong><p>It expires in 10 minutes.</p>`
      : `<p>Your gloomi verification code:</p><strong style="font-size:28px;letter-spacing:8px">${code}</strong><p>It expires in 10 minutes.</p>`;
    if (this.useResend) {
      const name = (SMTP_FROM_NAME || product).replace(/[<>\r\n]/g, '');
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: `${name} <${SMTP_FROM}>`, to: [payload.to], subject, text, html }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) { const error = new Error('Email API request failed') as Error & { code: string }; error.code = 'EMAIL_API_ERROR'; throw error; }
      this.lastVerifiedAt = new Date();
      this.lastFailure = undefined;
      return { accepted: true as const };
    }
    if (!this.transporter) throw new Error('SMTP transport is unavailable');
    const info = await this.transporter.sendMail({
      from: { address: SMTP_FROM, name: SMTP_FROM_NAME || product },
      to: payload.to,
      messageId: `<${messageId}@gloomi.local>`,
      subject,
      text,
      html,
    });
    const accepted = (info.accepted || []).some((address: string | { address: string }) =>
      (typeof address === 'string' ? address : address.address).toLowerCase() === payload.to.toLowerCase());
    if (!accepted) throw new Error('SMTP recipient not accepted');
    this.lastVerifiedAt = new Date();
    this.lastFailure = undefined;
    return { accepted: true as const };
    } catch (error) {
      this.lastFailure = this.safeFailure(error);
      this.logger.warn(`SMTP send failed (${this.lastFailure})`);
      throw new ServiceUnavailableException({ code: 'EMAIL_DELIVERY_FAILED', message: 'SMTP не подтвердил приём письма. Повторите отправку кода через минуту.' });
    }
  }
}
