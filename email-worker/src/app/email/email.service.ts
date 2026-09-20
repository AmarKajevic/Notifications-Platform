import { Injectable, Logger } from '@nestjs/common';
import nodemailer, { Transporter } from 'nodemailer';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  private readonly transporter: Transporter;

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT),
      secure: false,
    });
  }

  async sendEmail(
    recipient: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const subject =
      typeof payload.subject === 'string' ? payload.subject : 'Notification';

    const body =
      typeof payload.body === 'string' ? payload.body : JSON.stringify(payload);

    await this.transporter.sendMail({
      from: process.env.SMTP_FROM,
      to: recipient,
      subject,
      text: body,
    });

    this.logger.log(`Email sent to ${recipient}`);
  }
}
