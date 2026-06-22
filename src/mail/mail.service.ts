import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { Resend } from 'resend';
import type { Transporter } from 'nodemailer';

function resolvePublicFrontendUrl(): string {
  const rawUrl =
    process.env.FRONTEND_PUBLIC_URL ||
    process.env.FRONTEND_URL ||
    'http://localhost:5173';

  return rawUrl.replace(/\/$/, '');
}

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
    const verifyUrl = `${resolvePublicFrontendUrl()}/verify-email/${token}`;
    this.logger.log(`Lien de vérification email: ${verifyUrl}`);
    const from = process.env.RESEND_FROM || 'NovaSMS <onboarding@resend.dev>';

    const htmlContent = `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;text-align:center">
        <h1 style="color:#2EC80A">Bienvenue sur NovaSMS</h1>
        <p>Pour activer votre compte, cliquez sur le lien ci-dessous :</p>
        <a href="${verifyUrl}" style="display:inline-block;background:#2EC80A;color:#fff;padding:14px 28px;text-decoration:none;border-radius:8px;font-weight:bold;margin:20px 0">✅ Activer mon compte</a>
        <p style="font-size:13px;color:#666;margin-top:20px">Ou copiez ce lien : <a href="${verifyUrl}" style="color:#2EC80A">${verifyUrl}</a></p>
      </div>
    `;

    const testRecipient = process.env.RESEND_TEST_RECIPIENT;
    const toRecipients = testRecipient ? [testRecipient] : [email];

    if (testRecipient && ![email].includes(testRecipient)) {
      this.logger.warn(
        `TEST MODE: redirecting verification email intended for ${email} to ${testRecipient}`,
      );
    }

    if (this.transporter) {
      try {
        await this.transporter.sendMail({
          from,
          to: toRecipients,
          subject: '✅ Confirmez votre compte NovaSMS',
          html: htmlContent,
        });
        this.logger.log(`Email envoyé à ${toRecipients.join(', ')} (DEV-SMTP)`);
      } catch (error: unknown) {
        this.logger.error(`Erreur: ${(error as Error).message}`);
      }
      return;
    }

    if (this.resend) {
      try {
        const result = await this.resend.emails.send({
          from,
          to: toRecipients,
          subject: '✅ Confirmez votre compte NovaSMS',
          html: htmlContent,
        });

        if (result.error) {
          throw new Error(
            result.error.message || 'Erreur Resend vérification email',
          );
        }

        this.logger.log(`Email envoyé à ${toRecipients.join(', ')} (Resend)`);
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

    const from = process.env.RESEND_FROM || 'NovaSMS <onboarding@resend.dev>';

    const testRecipient = process.env.RESEND_TEST_RECIPIENT;
    const toRecipients = testRecipient ? [testRecipient] : [email];
    if (testRecipient && ![email].includes(testRecipient)) {
      this.logger.warn(
        `TEST MODE: redirecting 2FA email intended for ${email} to ${testRecipient}`,
      );
    }

    if (this.transporter) {
      try {
        await this.transporter.sendMail({
          from,
          to: toRecipients,
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
        const result = await this.resend.emails.send({
          from,
          to: toRecipients,
          subject: '🔐 Votre code de vérification NovaSMS',
          html: htmlContent,
        });

        if (result.error) {
          throw new Error(result.error.message || 'Erreur Resend 2FA');
        }

        if (this.isDev) {
          this.logger.log(
            `Code 2FA envoyé à ${email} (Resend) — code: ${code}`,
          );
        } else {
          this.logger.log(`Code 2FA envoyé à ${email} (Resend)`);
        }
      } catch (error: unknown) {
        this.logger.error(`Erreur Resend 2FA: ${(error as Error).message}`);
      }
    }
  }

  async sendPasswordResetEmail(email: string, token: string) {
    const resetUrl = `${resolvePublicFrontendUrl()}/reset-password/${token}`;

    this.logger.log(`Lien reset password: ${resetUrl}`);

    const htmlContent = `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;text-align:center">
        <h1 style="color:#2EC80A">Réinitialiser votre mot de passe</h1>
        <p>Votre demande de réinitialisation a été reçue.</p>
        <a href="${resetUrl}" style="display:inline-block;background:#2EC80A;color:#fff;padding:14px 28px;text-decoration:none;border-radius:8px;font-weight:bold;margin:20px 0">🔁 Réinitialiser</a>
        <p style="font-size:13px;color:#666;margin-top:20px">Ou copiez ce lien : <a href="${resetUrl}" style="color:#2EC80A">${resetUrl}</a></p>
        <p style="font-size:12px;color:#999;margin-top:20px">Ce lien expire bientôt. Si vous n’êtes pas à l’origine de cette demande, ignorez cet email.</p>
      </div>
    `;

    const testRecipient = process.env.RESEND_TEST_RECIPIENT;
    const toRecipients = testRecipient ? [testRecipient] : [email];
    if (testRecipient && ![email].includes(testRecipient)) {
      this.logger.warn(
        `TEST MODE: redirecting password reset intended for ${email} to ${testRecipient}`,
      );
    }

    const from = process.env.RESEND_FROM || 'NovaSMS <onboarding@resend.dev>';

    if (this.transporter) {
      try {
        await this.transporter.sendMail({
          from,
          to: toRecipients,
          subject: '🔁 Réinitialisation de votre mot de passe NovaSMS',
          html: htmlContent,
        });
        this.logger.log(
          `Password reset email envoyé à ${toRecipients.join(', ')} (DEV)`,
        );
      } catch (error: unknown) {
        this.logger.error(`Erreur reset password: ${(error as Error).message}`);
      }
      return;
    }

    if (this.resend) {
      try {
        const result = await this.resend.emails.send({
          from,
          to: toRecipients,
          subject: '🔁 Réinitialisation de votre mot de passe NovaSMS',
          html: htmlContent,
        });

        if (result.error) {
          throw new Error(
            result.error.message || 'Erreur Resend reset password',
          );
        }

        this.logger.log(
          `Password reset email envoyé à ${toRecipients.join(', ')} (Resend)`,
        );
      } catch (error: unknown) {
        this.logger.error(
          `Erreur Resend reset password: ${(error as Error).message}`,
        );
        throw error;
      }
      return;
    }

    throw new Error('Aucun service email configuré (Resend/SMTP).');
  }

  async sendCampaignSentNotification(
    email: string,
    payload: {
      campaignName: string;
      channelType: string;
      sentAt: Date;
    },
  ) {
    const sentAt = payload.sentAt.toLocaleString('fr-FR');
    const htmlContent = `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px">
        <h1 style="color:#2EC80A">Campagne envoyée</h1>
        <p>Votre campagne <strong>${payload.campaignName}</strong> a été envoyée.</p>
        <ul>
          <li>Canal: <strong>${payload.channelType}</strong></li>
          <li>Date d'envoi: <strong>${sentAt}</strong></li>
        </ul>
      </div>
    `;

    const subject = `Campagne envoyee: ${payload.campaignName}`;

    if (this.transporter) {
      try {
        await this.transporter.sendMail({
          from: 'NovaSMS <noreply@novasms.local>',
          to: email,
          subject,
          html: htmlContent,
        });
        this.logger.log(
          `Campaign sent notification email envoye a ${email} (DEV)`,
        );
      } catch (error: unknown) {
        this.logger.error(
          `Erreur campaign notification: ${(error as Error).message}`,
        );
      }
      return;
    }

    if (this.resend) {
      try {
        await this.resend.emails.send({
          from: 'NovaSMS <onboarding@resend.dev>',
          to: email,
          subject,
          html: htmlContent,
        });
        this.logger.log(
          `Campaign sent notification email envoye a ${email} (Resend)`,
        );
      } catch (error: unknown) {
        this.logger.error(
          `Erreur Resend campaign notification: ${(error as Error).message}`,
        );
      }
    }
  }

  async sendCampaignConfirmation(
    email: string,
    payload: {
      campaignName: string;
      contactEmail: string;
      sentAt: Date;
      campaignId: string;
    },
  ) {
    const sentAt = payload.sentAt.toLocaleString('fr-FR');
    const htmlContent = `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;border:1px solid #e0e0e0;border-radius:8px">
        <div style="background:#2EC80A;color:white;padding:16px;border-radius:8px 8px 0 0;text-align:center;margin:-20px -20px 20px -20px">
          <h2 style="margin:0;font-size:24px">✅ Email Confirmé</h2>
        </div>
        <p>Un email a été confirmé comme envoyé dans votre campagne.</p>
        <div style="background:#f5f5f5;padding:16px;border-radius:6px;margin:16px 0">
          <p style="margin:8px 0"><strong>Campagne:</strong> ${payload.campaignName}</p>
          <p style="margin:8px 0"><strong>Email du contact:</strong> ${payload.contactEmail}</p>
          <p style="margin:8px 0"><strong>Date d'envoi:</strong> ${sentAt}</p>
          <p style="margin:8px 0"><strong>ID campagne:</strong> <code style="background:#e0e0e0;padding:4px 8px;border-radius:4px">${payload.campaignId}</code></p>
        </div>
        <p style="font-size:12px;color:#666;margin-top:20px">Cet email est généré automatiquement via le système de webhooks de NovaSMS. Les métriques de votre campagne seront mises à jour en temps réel.</p>
      </div>
    `;

    const subject = `✅ Confirmation d'envoi - ${payload.campaignName}`;

    if (this.transporter) {
      try {
        await this.transporter.sendMail({
          from: 'NovaSMS <noreply@novasms.local>',
          to: email,
          subject,
          html: htmlContent,
        });
        this.logger.log(`Campaign confirmation email envoyé à ${email} (DEV)`);
      } catch (error: unknown) {
        this.logger.error(`Erreur confirmation: ${(error as Error).message}`);
      }
      return;
    }

    if (this.resend) {
      try {
        await this.resend.emails.send({
          from: 'NovaSMS <onboarding@resend.dev>',
          to: email,
          subject,
          html: htmlContent,
        });
        this.logger.log(
          `Campaign confirmation email envoyé à ${email} (Resend)`,
        );
      } catch (error: unknown) {
        this.logger.error(
          `Erreur Resend confirmation: ${(error as Error).message}`,
        );
      }
    }
  }

  async sendInvitationEmail(email: string, token: string, invitedBy: string) {
    const inviteUrl = `${resolvePublicFrontendUrl()}/accept-invitation/${token}`;
    const from = process.env.RESEND_FROM || 'NovaSMS <onboarding@resend.dev>';
    const subject = `Invitation à rejoindre l'équipe NovaSMS`;
    const htmlContent = `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;text-align:center">
        <h1 style="color:#2EC80A">Vous êtes invité !</h1>
        <p><strong>${invitedBy}</strong> vous invite à rejoindre son espace NovaSMS.</p>
        <a href="${inviteUrl}" style="display:inline-block;background:#2EC80A;color:#fff;padding:14px 28px;text-decoration:none;border-radius:8px;font-weight:bold;margin:20px 0">Accepter l'invitation</a>
        <p style="font-size:13px;color:#666;margin-top:20px">Ou copiez ce lien : <a href="${inviteUrl}" style="color:#2EC80A">${inviteUrl}</a></p>
        <p style="font-size:12px;color:#999;margin-top:20px">Ce lien est valide 7 jours. Si vous n'attendiez pas cette invitation, ignorez cet email.</p>
      </div>
    `;

    if (this.transporter) {
      try {
        await this.transporter.sendMail({
          from,
          to: email,
          subject,
          html: htmlContent,
        });
        this.logger.log(`Invitation envoyée à ${email} (DEV)`);
      } catch (error: unknown) {
        this.logger.error(
          `Erreur invitation SMTP: ${(error as Error).message}`,
        );
      }
      return;
    }

    if (this.resend) {
      try {
        const result = await this.resend.emails.send({
          from,
          to: email,
          subject,
          html: htmlContent,
        });
        if (result.error) throw new Error(result.error.message);
        this.logger.log(`Invitation envoyée à ${email} (Resend)`);
      } catch (error: unknown) {
        this.logger.error(
          `Erreur Resend invitation: ${(error as Error).message}`,
        );
      }
    }
  }
}
