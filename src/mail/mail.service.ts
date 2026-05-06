import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { Resend } from 'resend';
import type { Transporter } from 'nodemailer';

@Injectable()
export class MailService {
  private readonly resend: Resend | null;
  private readonly transporter: Transporter | null;
  private readonly logger = new Logger(MailService.name);
  private readonly isDev: boolean;

  constructor() {
    const apiKey = process.env.RESEND_API_KEY;
    this.isDev = process.env.NODE_ENV !== 'production';

    if (apiKey) {
      this.resend = new Resend(apiKey);
      this.transporter = null;
      this.logger.log('📧 MailService: Mode Resend activé');
    } else if (this.isDev) {
      this.resend = null;
      this.transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'localhost',
        port: Number.parseInt(process.env.SMTP_PORT || '2500', 10),
        secure: false,
      });
      this.logger.warn('📧 RESEND_API_KEY manquante, fallback SMTP dev activé');
    } else {
      this.resend = null;
      this.transporter = null;
    }
  }

  async sendVerificationEmail(email: string, token: string) {
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const verifyUrl = `${frontendUrl}/verify-email/${token}`;
    console.log('📧 LIEN DE VÉRIFICATION EMAIL:', verifyUrl);

    const htmlContent = `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;text-align:center">
        <h1 style="color:#2EC80A">Bienvenue sur NovaSMS</h1>
        <p>Pour activer votre compte, cliquez sur le lien ci-dessous :</p>
        <a href="${verifyUrl}" style="display:inline-block;background:#2EC80A;color:#fff;padding:14px 28px;text-decoration:none;border-radius:8px;font-weight:bold;margin:20px 0">✅ Activer mon compte</a>
        <p style="font-size:13px;color:#666;margin-top:20px">Ou copiez ce lien : <a href="${verifyUrl}" style="color:#2EC80A">${verifyUrl}</a></p>
      </div>
    `;

    if (this.transporter) {
      try {
        await this.transporter.sendMail({
          from: 'NovaSMS <noreply@novasms.local>',
          to: email,
          subject: '✅ Confirmez votre compte NovaSMS',
          html: htmlContent,
        });
        this.logger.log(`Email envoyé à ${email} (DEV)`);
      } catch (error: unknown) {
        this.logger.error(`Erreur: ${(error as Error).message}`);
      }
      return;
    }

    if (this.resend) {
      try {
        await this.resend.emails.send({
          from: 'NovaSMS <onboarding@resend.dev>',
          to: email,
          subject: '✅ Confirmez votre compte NovaSMS',
          html: htmlContent,
        });
        this.logger.log(`Email envoyé à ${email} (Resend)`);
      } catch (error: unknown) {
        this.logger.error(`Erreur Resend: ${(error as Error).message}`);
      }
    }
  }

  async sendTwoFactorCodeEmail(email: string, code: string) {
    const htmlContent = `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;text-align:center">
        <h1 style="color:#2EC80A">Code de vérification NovaSMS</h1>
        <p>Voici votre code de connexion à usage unique :</p>
        <div style="display:inline-block;background:#EDFCE8;color:#145C04;padding:16px 24px;border-radius:12px;font-size:32px;letter-spacing:0.2em;font-weight:bold;margin:20px 0">${code}</div>
        <p style="font-size:13px;color:#666;margin-top:20px">Ce code expire dans 10 minutes.</p>
      </div>
    `;

    if (this.transporter) {
      try {
        await this.transporter.sendMail({
          from: 'NovaSMS <noreply@novasms.local>',
          to: email,
          subject: '🔐 Votre code de vérification NovaSMS',
          html: htmlContent,
        });
        if (this.isDev) {
          this.logger.log(`Code 2FA envoyé à ${email} (DEV) — code: ${code}`);
        } else {
          this.logger.log(`Code 2FA envoyé à ${email} (DEV)`);
        }
      } catch (error: unknown) {
        this.logger.error(`Erreur 2FA: ${(error as Error).message}`);
      }
      return;
    }

    if (this.resend) {
      try {
        await this.resend.emails.send({
          from: 'NovaSMS <onboarding@resend.dev>',
          to: email,
          subject: '🔐 Votre code de vérification NovaSMS',
          html: htmlContent,
        });
        if (this.isDev) {
          this.logger.log(`Code 2FA envoyé à ${email} (Resend) — code: ${code}`);
        } else {
          this.logger.log(`Code 2FA envoyé à ${email} (Resend)`);
        }
      } catch (error: unknown) {
        this.logger.error(`Erreur Resend 2FA: ${(error as Error).message}`);
      }
    }
  }
}
