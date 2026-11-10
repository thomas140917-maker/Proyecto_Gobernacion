import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: nodemailer.Transporter;

  constructor(private readonly config: ConfigService) {
    const user = config.get<string>('SMTP_USER');
    this.transporter = nodemailer.createTransport({
      host: config.get<string>('SMTP_HOST', 'localhost'),
      port: Number(config.get('SMTP_PORT', 1025)),
      secure: config.get('SMTP_SECURE') === 'true',
      auth: user ? { user, pass: config.get<string>('SMTP_PASS') } : undefined,
    });
  }

  async enviarRecuperacion(to: string, nombre: string, enlace: string) {
    await this.transporter.sendMail({
      from: this.config.get<string>('MAIL_FROM', 'no-reply@centroactoral.com'),
      to,
      subject: 'Recuperación de contraseña - Centro Actoral de Boyacá',
      text:
        `Hola ${nombre},\n\nRecibimos una solicitud para restablecer tu contraseña.\n` +
        `Usa este enlace (válido por 30 minutos, un solo uso):\n${enlace}\n\n` +
        `Si no fuiste tú, ignora este mensaje.`,
      html:
        `<p>Recibimos una solicitud para restablecer tu contraseña.</p>` +
        `<p><a href="${enlace}">Restablecer contraseña</a> (válido por 30 minutos, un solo uso).</p>` +
        `<p>Si no fuiste tú, ignora este mensaje.</p>`,
    });
    this.logger.log(`Correo de recuperación enviado a ${to}`);
  }
}
