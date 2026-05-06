import {
  Injectable,
  ConflictException,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import * as bcrypt from 'bcryptjs';
import { RegisterDto } from './dto/register.dto';
import { v4 as uuidv4 } from 'uuid';
import * as speakeasy from 'speakeasy';

const LOGIN_LOCK_THRESHOLD = 5;
const LOGIN_LOCK_MINUTES = 15;
const TWO_FACTOR_CODE_TTL_MINUTES = 10;

type AuthAccount = {
  id: string;
  companyName: string;
  adminEmail: string;
  passwordHash: string;
  emailVerified: boolean;
  loginAttempts: number;
  lockedUntil: Date | null;
  twoFactorEnabled: boolean;
  twoFactorCode: string | null;
  twoFactorCodeExpiry: Date | null;
  twoFactorSecret: string | null;
  backupCodes?: string[];
  // ✅ NOUVEAUX CHAMPS pour Wizard + RBAC + Multi-tenant
  onboardingCompleted: boolean;
  role: string; // "admin", "editor", "analyst"
};

type AuthTokens = {
  accessToken: string;
  refreshToken: string;
};

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private mail: MailService,
    private jwtService: JwtService,
  ) {}

  async register(data: RegisterDto) {
    const existing = await this.prisma.account.findUnique({
      where: { adminEmail: data.email },
    });

    if (existing) {
      throw new ConflictException(
        'This email is already associated with an account.',
      );
    }

    const hashedPassword = await bcrypt.hash(data.motDePasse, 12);

    const token = uuidv4();
    const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await this.prisma.account.create({
      data: {
        companyName: data.nom,
        adminEmail: data.email,
        passwordHash: hashedPassword,
        country: data.pays,
        creditBalance: 0,
        confirmationToken: token,
        tokenExpiry: expiry,
        emailVerified: false,
        onboardingCompleted: false, // ✅ Valeur par défaut
      },
    });

    await this.mail.sendVerificationEmail(data.email, token);

    return {
      success: true,
      message: 'Account created. Please check your email to verify.',
    };
  }

  async verifyEmail(token: string) {
    if (!token) {
      throw new BadRequestException('Token missing');
    }

    const account = await this.prisma.account.findFirst({
      where: {
        confirmationToken: token,
        tokenExpiry: { gte: new Date() },
      },
    });

    if (!account) {
      throw new BadRequestException('Invalid or expired token');
    }

    await this.prisma.account.update({
      where: { id: account.id },
      data: {
        emailVerified: true,
        confirmationToken: null,
        tokenExpiry: null,
      },
    });

    console.log(`[Auth] Email verified: ${account.adminEmail}`);
    return {
      success: true,
      message: 'Email verified successfully',
    };
  }

  async resendConfirmationEmail(email: string) {
    if (!email) {
      throw new BadRequestException('Email missing');
    }

    const account = await this.prisma.account.findUnique({
      where: { adminEmail: email },
    });

    if (!account) {
      throw new BadRequestException('Account not found');
    }

    if (account.emailVerified) {
      return {
        success: true,
        message: 'This email is already verified.',
      };
    }

    const token = uuidv4();
    const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await this.prisma.account.update({
      where: { id: account.id },
      data: {
        confirmationToken: token,
        tokenExpiry: expiry,
      },
    });

    await this.mail.sendVerificationEmail(email, token);

    return {
      success: true,
      message: 'Confirmation email sent successfully.',
    };
  }

  async login(email: string, password: string) {
    const account = await this.prisma.account.findUnique({
      where: { adminEmail: email },
    });

    if (!account) {
      throw new UnauthorizedException('Email ou mot de passe incorrect');
    }

    if (!account.emailVerified) {
      throw new UnauthorizedException(
        'Veuillez valider votre email avant de vous connecter.',
      );
    }

    const authAccount = account as unknown as AuthAccount;
    const now = new Date();

    // Vérifier blocage temporaire
    if (authAccount.lockedUntil && authAccount.lockedUntil > now) {
      const remainingMinutes = Math.max(
        1,
        Math.ceil((authAccount.lockedUntil.getTime() - now.getTime()) / 60000),
      );
      throw new UnauthorizedException(
        `Compte temporairement bloqué. Réessayez dans ${remainingMinutes} minute(s).`,
      );
    }

    // Réinitialiser blocage si expiré
    if (authAccount.lockedUntil && authAccount.lockedUntil <= now) {
      await this.prisma.account.update({
        where: { id: authAccount.id },
        data: { loginAttempts: 0, lockedUntil: null },
      });
      authAccount.loginAttempts = 0;
      authAccount.lockedUntil = null;
    }

    // Vérifier mot de passe
    const isPasswordValid = await this.verifyPassword(
      password,
      authAccount.passwordHash,
    );

    if (!isPasswordValid) {
      const nextAttempts = authAccount.loginAttempts + 1;

      if (nextAttempts >= LOGIN_LOCK_THRESHOLD) {
        const lockedUntil = new Date(
          Date.now() + LOGIN_LOCK_MINUTES * 60 * 1000,
        );
        await this.prisma.account.update({
          where: { id: authAccount.id },
          data: { loginAttempts: 0, lockedUntil },
        });
        throw new UnauthorizedException(
          `Compte bloqué après ${LOGIN_LOCK_THRESHOLD} tentatives échouées. Réessayez dans ${LOGIN_LOCK_MINUTES} minutes.`,
        );
      }

      await this.prisma.account.update({
        where: { id: authAccount.id },
        data: { loginAttempts: nextAttempts },
      });
      throw new UnauthorizedException('Email ou mot de passe incorrect');
    }

    // Réinitialiser tentatives après succès
    await this.prisma.account.update({
      where: { id: authAccount.id },
      data: { loginAttempts: 0, lockedUntil: null },
    });

    // 2FA si activé
    if (authAccount.twoFactorEnabled) {
      const twoFactorCode = this.generateTwoFactorCode();
      const twoFactorCodeExpiry = new Date(
        Date.now() + TWO_FACTOR_CODE_TTL_MINUTES * 60 * 1000,
      );
      const twoFactorToken = this.generateTwoFactorToken(authAccount);

      await this.prisma.account.update({
        where: { id: authAccount.id },
        data: { twoFactorCode, twoFactorCodeExpiry },
      });

      await this.mail.sendTwoFactorCodeEmail(
        authAccount.adminEmail,
        twoFactorCode,
      );

      return {
        success: true,
        requiresTwoFactor: true,
        twoFactorToken,
        message: 'Un code de vérification a été envoyé à votre adresse email.',
        account: {
          id: authAccount.id,
          email: authAccount.adminEmail,
          name: authAccount.companyName,
          onboardingCompleted: authAccount.onboardingCompleted, // ✅ Pour redirection frontend
        },
      };
    }

    // Génération tokens JWT
    const tokens = this.generateTokens(authAccount);

    return {
      success: true,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      account: {
        id: authAccount.id,
        email: authAccount.adminEmail,
        name: authAccount.companyName,
        onboardingCompleted: authAccount.onboardingCompleted, // ✅ CLÉ pour Wizard/Dashboard
      },
    };
  }

  async verifyTwoFactor(twoFactorToken: string, code: string) {
    if (!twoFactorToken || !code) {
      throw new BadRequestException('Token 2FA et code requis');
    }

    let payload: { sub?: string; purpose?: string; accountId?: string };

    try {
      payload = this.jwtService.verify<{ sub?: string; purpose?: string; accountId?: string }>(
        twoFactorToken,
        { secret: process.env.JWT_ACCESS_SECRET },
      );
    } catch {
      throw new UnauthorizedException('Code de vérification invalide ou expiré');
    }

    if (payload.purpose !== 'two-factor' || !payload.sub) {
      throw new UnauthorizedException('Code de vérification invalide ou expiré');
    }

    const account = await this.prisma.account.findUnique({
      where: { id: payload.sub },
    });

    if (!account) {
      throw new UnauthorizedException('Compte introuvable');
    }

    const authAccount = account as unknown as AuthAccount;
    const now = new Date();

    if (!authAccount.twoFactorEnabled) {
      throw new UnauthorizedException('La double authentification est désactivée');
    }

    const normalizedCode = code.trim();
    const backupCodes = Array.isArray(authAccount.backupCodes) ? authAccount.backupCodes : [];
    const matchedBackupCode = backupCodes.find((bc) => bc === normalizedCode);

    if (!matchedBackupCode) {
      if (!authAccount.twoFactorCode || !authAccount.twoFactorCodeExpiry) {
        throw new UnauthorizedException('Code de vérification expiré');
      }
      if (authAccount.twoFactorCodeExpiry < now) {
        await this.prisma.account.update({
          where: { id: authAccount.id },
          data: { twoFactorCode: null, twoFactorCodeExpiry: null },
        });
        throw new UnauthorizedException('Code de vérification expiré');
      }
      if (authAccount.twoFactorCode !== normalizedCode) {
        throw new UnauthorizedException('Code de vérification incorrect');
      }
    }

    await this.prisma.account.update({
      where: { id: authAccount.id },
      data: {
        twoFactorCode: null,
        twoFactorCodeExpiry: null,
        backupCodes: matchedBackupCode
          ? backupCodes.filter((bc) => bc !== matchedBackupCode)
          : backupCodes,
        loginAttempts: 0,
        lockedUntil: null,
      },
    });

    const tokens = this.generateTokens(authAccount);

    return {
      success: true,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      account: {
        id: authAccount.id,
        email: authAccount.adminEmail,
        name: authAccount.companyName,
        onboardingCompleted: authAccount.onboardingCompleted, // ✅ Pour redirection frontend
      },
    };
  }

  // ✅ NOUVELLE MÉTHODE — Marquer onboarding comme complété
  async markOnboardingCompleted(accountId: string) {
    await this.prisma.account.update({
      where: { id: accountId },
      data: { onboardingCompleted: true },
    });
    return { success: true, message: 'Onboarding marked as completed' };
  }

  private async verifyPassword(plainPassword: string, hash: string): Promise<boolean> {
    return await bcrypt.compare(plainPassword, hash);
  }

  private generateTokens(account: AuthAccount): AuthTokens {
    // ✅ Payload enrichi pour multi-tenant + RBAC
    const payload = {
      sub: account.id,
      email: account.adminEmail,
      accountId: account.id, // 🔑 Isolation données entre entreprises
      role: account.role || 'admin', // 🔑 Permissions dans l'entreprise
    };

    const accessTokenExpiresIn = process.env
      .JWT_ACCESS_EXPIRATION as JwtSignOptions['expiresIn'];
    const refreshTokenExpiresIn = process.env
      .JWT_REFRESH_EXPIRATION as JwtSignOptions['expiresIn'];

    return {
      accessToken: this.jwtService.sign(payload, {
        secret: process.env.JWT_ACCESS_SECRET,
        expiresIn: accessTokenExpiresIn,
      }),
      refreshToken: this.jwtService.sign(payload, {
        secret: process.env.JWT_REFRESH_SECRET,
        expiresIn: refreshTokenExpiresIn,
      }),
    };
  }

  private generateTwoFactorCode(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  private generateTwoFactorToken(account: AuthAccount): string {
    return this.jwtService.sign(
      {
        sub: account.id,
        email: account.adminEmail,
        purpose: 'two-factor',
      },
      {
        secret: process.env.JWT_ACCESS_SECRET,
        expiresIn: `${TWO_FACTOR_CODE_TTL_MINUTES}m` as JwtSignOptions['expiresIn'],
      },
    );
  }

  private generateBackupCodes(count = 10): string[] {
    const codes: string[] = [];
    for (let i = 0; i < count; i++) {
      const code = `${Math.floor(Math.random() * 10000)
        .toString()
        .padStart(4, '0')}-${Math.floor(Math.random() * 10000)
        .toString()
        .padStart(4, '0')}`;
      codes.push(code);
    }
    return codes;
  }

  // --- 2FA helpers ---
  async generateTwoFactorSecret(accountId: string) {
    if (!accountId) throw new BadRequestException('accountId missing');

    const account = await this.prisma.account.findUnique({ where: { id: accountId } });
    if (!account) throw new BadRequestException('Account not found');

    const secret = speakeasy.generateSecret({
      name: `NovaSMS (${account.adminEmail})`,
      issuer: 'NovaSMS',
      length: 32,
    });

    await this.prisma.account.update({ 
      where: { id: accountId }, 
      data: { twoFactorSecret: secret.base32 } 
    });

    return { 
      success: true, 
      secret: secret.base32, 
      otpauth_url: secret.otpauth_url,
    };
  }

  async enableTwoFactor(accountId: string, code: string) {
    if (!accountId || !code) throw new BadRequestException('accountId and code required');

    const account = await this.prisma.account.findUnique({ where: { id: accountId } });
    if (!account) throw new BadRequestException('Account not found');
    
    const secret = (account as any).twoFactorSecret;
    if (!secret) throw new BadRequestException('2FA secret not set');

    const ok = speakeasy.totp.verify({
      secret,
      encoding: 'base32',
      token: code.trim(),
      window: 2,
    });
    if (!ok) throw new UnauthorizedException('Code invalide');

    const backupCodes = this.generateBackupCodes(10);

    await this.prisma.account.update({ 
      where: { id: accountId }, 
      data: { 
        twoFactorEnabled: true,
        backupCodes: backupCodes,
      } 
    });
    
    return { 
      success: true, 
      message: '2FA activée avec succès',
      backup_codes: backupCodes,
    };
  }

  async disableTwoFactor(accountId: string) {
    if (!accountId) throw new BadRequestException('accountId required');
    const account = await this.prisma.account.findUnique({ where: { id: accountId } });
    if (!account) throw new BadRequestException('Account not found');

    await this.prisma.account.update({ 
      where: { id: accountId }, 
      data: { twoFactorEnabled: false, twoFactorSecret: null } 
    });
    return { success: true, message: '2FA désactivée' };
  }

  async sendTwoFactorSms(accountId: string, phone?: string) {
    if (!accountId) throw new BadRequestException('accountId required');
    const account = await this.prisma.account.findUnique({ where: { id: accountId } });
    if (!account) throw new BadRequestException('Account not found');

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiry = new Date(Date.now() + 10 * 60 * 1000);

    await this.prisma.account.update({ 
      where: { id: accountId }, 
      data: { twoFactorCode: code, twoFactorCodeExpiry: expiry } 
    });

    console.log(`[Auth] 2FA SMS code for ${account.adminEmail}: ${code}`);

    return { success: true, message: 'Code 2FA envoyé (placeholder)' };
  }

  // New helper: get account info for frontend
  async getAccount(accountId: string) {
    if (!accountId) throw new BadRequestException('accountId required');
    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
      select: {
        id: true,
        adminEmail: true,
        companyName: true,
        twoFactorEnabled: true,
        backupCodes: true,
        twoFactorSecret: true,
        onboardingCompleted: true,
      },
    });
    if (!account) throw new BadRequestException('Account not found');
    return { success: true, account };
  }
}