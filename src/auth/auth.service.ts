import {
  Injectable,
  ConflictException,
  Logger,
  BadRequestException,
  UnauthorizedException,
  InternalServerErrorException,
} from '@nestjs/common';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { SmsProviderFactory } from '../providers/sms/sms.provider.factory';
import * as bcrypt from 'bcryptjs';
import { RegisterDto } from './dto/register.dto';
import { randomUUID, randomInt } from 'crypto';
import * as speakeasy from 'speakeasy';
import { UserRole } from '@prisma/client'; // ✅ Import de l'enum Prisma

const LOGIN_LOCK_THRESHOLD = 5;
const LOGIN_LOCK_MINUTES = 15;
const TWO_FACTOR_CODE_TTL_MINUTES = 10;

type AuthAccount = {
  id: string;
  companyName: string;
  adminEmail: string;
  passwordHash: string;
  sector: string | null;
  primaryChannels: string[];
  emailVerified: boolean;
  loginAttempts: number;
  lockedUntil: Date | null;
  twoFactorCode: string | null;
  twoFactorCodeExpiry: Date | null;
  twoFactorSecret: string | null;
  backupCodes?: string[];
  onboardingCompleted: boolean;
};

type AuthUser = {
  id: string;
  accountId: string;
  email: string;
  passwordHash: string;
  role: UserRole; // ✅ Type enum Prisma
  twoFactorEnabled: boolean;
};

type AuthTokens = {
  accessToken: string;
  refreshToken: string;
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private mail: MailService,
    private jwtService: JwtService,
    private smsProviderFactory: SmsProviderFactory,
  ) {}

  async register(
    data:
      | RegisterDto
      | {
          adminEmail?: string;
          password?: string;
          companyName?: string;
          country?: string;
        },
  ) {
    // Normalize incoming payloads: support both French DTO and older API shape
    const raw = (data ?? {}) as Record<string, string | undefined>;
    const email = raw.email ?? raw.adminEmail ?? null;
    const password = raw.motDePasse ?? raw.password ?? null;
    const nom = raw.nom ?? raw.companyName ?? 'Nouvelle entreprise';
    const pays = raw.pays ?? raw.country ?? 'CI';

    if (!email || !password) {
      throw new BadRequestException('Email and password are required');
    }

    const existing = await this.prisma.account.findUnique({
      where: { adminEmail: email },
    });

    if (existing) {
      throw new ConflictException(
        'This email is already associated with an account.',
      );
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const token = randomUUID();
    const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await this.prisma.account.create({
      data: {
        companyName: nom,
        adminEmail: email,
        passwordHash: hashedPassword,
        country: pays,
        creditBalance: 0,
        confirmationToken: token,
        tokenExpiry: expiry,
        emailVerified: false,
        onboardingCompleted: false,
      },
    });

    const createdAccount = await this.prisma.account.findUnique({
      where: { adminEmail: email },
      select: { id: true, adminEmail: true, companyName: true },
    });

    if (!createdAccount) {
      throw new BadRequestException('Account creation failed');
    }

    await this.prisma.user.create({
      data: {
        accountId: createdAccount.id,
        email,
        passwordHash: hashedPassword,
        role: UserRole.Admin,
        twoFactorEnabled: false,
      },
    });

    // US-001: audit log pour traçabilité inscription
    try {
      await this.prisma.auditLog.create({
        data: {
          accountId: createdAccount.id,
          userId: createdAccount.id,
          action: 'registration_complete',
          details: { email, companyName: nom },
        },
      });
    } catch {
      // non-bloquant : l'inscription réussit même si l'audit log échoue
    }

    // send verification email (best-effort)
    try {
      await this.mail.sendVerificationEmail(email, token);
    } catch (err) {
      // don't block registration if mail fails in tests
      this.logger.warn(
        `Failed to send verification email: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Build minimal auth account object for token generation
    const authAccount = {
      id: createdAccount.id,
      companyName: createdAccount.companyName || nom,
      adminEmail: createdAccount.adminEmail || email,
      passwordHash: hashedPassword,
      sector: null,
      primaryChannels: [],
      emailVerified: false,
      loginAttempts: 0,
      lockedUntil: null,
      twoFactorCode: null,
      twoFactorCodeExpiry: null,
      twoFactorSecret: null,
      onboardingCompleted: false,
    } as unknown as AuthAccount;

    const tokens = this.generateTokens(authAccount, UserRole.Admin);

    return {
      success: true,
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      account: { id: createdAccount.id },
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

    this.logger.log(`Email verified: ${account.adminEmail}`);
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

    const token = randomUUID();
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
    const normalizedEmail = email.trim().toLowerCase();
    const account = await this.prisma.account.findFirst({
      where: { adminEmail: { equals: normalizedEmail, mode: 'insensitive' } },
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
    const primaryUser = await this.getPrimaryUser(authAccount);
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

    // 2FA si active: authenticator TOTP + backup codes uniquement
    if (primaryUser.twoFactorEnabled) {
      const twoFactorToken = this.generateTwoFactorToken(authAccount);

      // cleanup legacy email-based 2FA fields
      await this.prisma.account.update({
        where: { id: authAccount.id },
        data: { twoFactorCode: null, twoFactorCodeExpiry: null },
      });

      return {
        success: true,
        requiresTwoFactor: true,
        twoFactorToken,
        message:
          'Entrez le code de votre application Authenticator ou un backup code.',
        account: {
          id: authAccount.id,
          email: authAccount.adminEmail,
          name: authAccount.companyName,
          role: primaryUser.role,
          sector: authAccount.sector,
          primaryChannels: authAccount.primaryChannels,
          onboardingCompleted: authAccount.onboardingCompleted,
        },
      };
    }

    const tokens = this.generateTokens(authAccount, primaryUser.role);

    return {
      success: true,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      account: {
        id: authAccount.id,
        email: authAccount.adminEmail,
        name: authAccount.companyName,
        role: primaryUser.role,
        sector: authAccount.sector,
        primaryChannels: authAccount.primaryChannels,
        onboardingCompleted: authAccount.onboardingCompleted,
      },
    };
  }

  async verifyTwoFactor(twoFactorToken: string, code: string) {
    if (!twoFactorToken || !code) {
      throw new BadRequestException('Token 2FA et code requis');
    }

    let payload: { sub?: string; purpose?: string; accountId?: string };

    try {
      payload = this.jwtService.verify<{
        sub?: string;
        purpose?: string;
        accountId?: string;
      }>(twoFactorToken, { secret: process.env.JWT_ACCESS_SECRET });
    } catch {
      throw new UnauthorizedException(
        'Code de vérification invalide ou expiré',
      );
    }

    if (payload.purpose !== 'two-factor' || !payload.sub) {
      throw new UnauthorizedException(
        'Code de vérification invalide ou expiré',
      );
    }

    const account = await this.prisma.account.findUnique({
      where: { id: payload.sub },
    });

    if (!account) {
      throw new UnauthorizedException('Compte introuvable');
    }

    const authAccount = account as unknown as AuthAccount;
    const primaryUser = await this.getPrimaryUser(authAccount);

    if (!primaryUser.twoFactorEnabled) {
      throw new UnauthorizedException(
        'La double authentification est désactivée',
      );
    }

    const normalizedCode = code.trim();
    const backupCodes = Array.isArray(authAccount.backupCodes)
      ? authAccount.backupCodes
      : [];
    const matchedBackupCode = backupCodes.find((bc) => bc === normalizedCode);

    let isTotpValid = false;
    if (authAccount.twoFactorSecret) {
      isTotpValid = speakeasy.totp.verify({
        secret: authAccount.twoFactorSecret,
        encoding: 'base32',
        token: normalizedCode,
        window: 2,
      });
    }

    if (!isTotpValid && !matchedBackupCode) {
      throw new UnauthorizedException('Code de vérification incorrect');
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

    const tokens = this.generateTokens(authAccount, primaryUser.role);

    return {
      success: true,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      account: {
        id: authAccount.id,
        email: authAccount.adminEmail,
        name: authAccount.companyName,
        role: primaryUser.role,
        sector: authAccount.sector,
        primaryChannels: authAccount.primaryChannels,
        onboardingCompleted: authAccount.onboardingCompleted,
      },
    };
  }

  async refreshTokens(refreshToken: string) {
    if (!refreshToken) {
      throw new BadRequestException('refreshToken requis');
    }

    let payload: { sub?: string; email?: string };
    try {
      payload = this.jwtService.verify<{ sub?: string; email?: string }>(
        refreshToken,
        {
          secret: process.env.JWT_REFRESH_SECRET,
        },
      );
    } catch {
      throw new UnauthorizedException('Refresh token invalide ou expiré');
    }

    if (!payload.sub || !payload.email) {
      throw new UnauthorizedException('Refresh token invalide');
    }

    const account = await this.prisma.account.findUnique({
      where: { id: payload.sub },
    });

    if (!account || account.adminEmail !== payload.email) {
      throw new UnauthorizedException('Compte introuvable pour ce token');
    }

    const authAccount = account as unknown as AuthAccount;
    const primaryUser = await this.getPrimaryUser(authAccount);
    const tokens = this.generateTokens(authAccount, primaryUser.role);

    return {
      success: true,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    };
  }

  async markOnboardingCompleted(accountId: string) {
    await this.prisma.account.update({
      where: { id: accountId },
      data: { onboardingCompleted: true },
    });
    return { success: true, message: 'Onboarding marked as completed' };
  }

  // ✅ Reset password (US-002)
  async requestPasswordReset(email: string) {
    if (!email) {
      throw new BadRequestException('Email requis');
    }

    const normalizedEmail = email.trim().toLowerCase();

    const account = await this.prisma.account.findFirst({
      where: { adminEmail: { equals: normalizedEmail, mode: 'insensitive' } },
      select: { id: true, adminEmail: true },
    });

    if (!account) {
      return {
        success: true,
        message: 'Si le compte existe, un email sera envoyé.',
      };
    }

    const token = randomUUID();
    const expiry = new Date(Date.now() + 60 * 60 * 1000);

    await this.prisma.account.update({
      where: { id: account.id },
      data: { resetPasswordToken: token, resetPasswordExpiry: expiry },
    });

    try {
      await this.mail.sendPasswordResetEmail(account.adminEmail, token);
    } catch (error) {
      throw new InternalServerErrorException(
        error instanceof Error
          ? error.message
          : "Impossible d'envoyer l'email de réinitialisation.",
      );
    }

    return { success: true, message: 'Email de réinitialisation envoyé.' };
  }

  async resetPassword(token: string, newPassword: string) {
    if (!token) {
      throw new BadRequestException('Token requis');
    }

    const account = await this.prisma.account.findFirst({
      where: {
        resetPasswordToken: token,
        resetPasswordExpiry: { gte: new Date() },
      },
    });

    if (!account) {
      throw new UnauthorizedException('Token invalide ou expiré');
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);

    await this.prisma.account.update({
      where: { id: account.id },
      data: {
        passwordHash: hashedPassword,
        resetPasswordToken: null,
        resetPasswordExpiry: null,
        loginAttempts: 0,
        lockedUntil: null,
      },
    });

    return { success: true, message: 'Mot de passe réinitialisé avec succès.' };
  }

  async updateProfile(
    accountId: string,
    profile: {
      companyName: string;
      role?: string;
      sector?: string;
      primaryChannels?: string[];
    },
  ) {
    if (!accountId) throw new BadRequestException('accountId required');

    const companyName = profile.companyName.trim();
    if (!companyName) {
      throw new BadRequestException('Company name required');
    }

    // ✅ Correction: normaliser le rôle en enum UserRole
    const normalizedRole = this.normalizeRoleToEnum(profile.role);

    const accountSnapshot = await this.prisma.account.findUnique({
      where: { id: accountId },
      select: {
        id: true,
        adminEmail: true,
        passwordHash: true,
      },
    });

    if (!accountSnapshot) {
      throw new BadRequestException('Account not found');
    }

    const account = await this.prisma.account.update({
      where: { id: accountId },
      data: { companyName },
      select: {
        id: true,
        adminEmail: true,
        companyName: true,
        onboardingCompleted: true,
      },
    });

    const user = await this.getPrimaryUser(
      {
        id: account.id,
        companyName: account.companyName,
        adminEmail: account.adminEmail,
        passwordHash: accountSnapshot.passwordHash,
        sector: null,
        primaryChannels: [],
        emailVerified: true,
        loginAttempts: 0,
        lockedUntil: null,
        twoFactorCode: null,
        twoFactorCodeExpiry: null,
        twoFactorSecret: null,
        backupCodes: [],
        onboardingCompleted: account.onboardingCompleted,
      },
      normalizedRole,
    );

    return {
      success: true,
      account: {
        ...account,
        sector: null,
        primaryChannels: [],
        role: user.role,
        twoFactorEnabled: user.twoFactorEnabled,
      },
    };
  }

  private async verifyPassword(
    plainPassword: string,
    hash: string,
  ): Promise<boolean> {
    return await bcrypt.compare(plainPassword, hash);
  }

  private generateTokens(account: AuthAccount, role: UserRole): AuthTokens {
    const payload = {
      sub: account.id,
      email: account.adminEmail,
      accountId: account.id,
      role,
      onboardingCompleted: account.onboardingCompleted,
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

  private generateTwoFactorToken(account: AuthAccount): string {
    return this.jwtService.sign(
      {
        sub: account.id,
        email: account.adminEmail,
        purpose: 'two-factor',
      },
      {
        secret: process.env.JWT_ACCESS_SECRET,
        expiresIn:
          `${TWO_FACTOR_CODE_TTL_MINUTES}m` as JwtSignOptions['expiresIn'],
      },
    );
  }

  private generateBackupCodes(count = 10): string[] {
    const codes: string[] = [];
    for (let i = 0; i < count; i++) {
      const a = randomInt(0, 10000).toString().padStart(4, '0');
      const b = randomInt(0, 10000).toString().padStart(4, '0');
      codes.push(`${a}-${b}`);
    }
    return codes;
  }

  // --- 2FA helpers ---
  async generateTwoFactorSecret(accountId: string) {
    if (!accountId) throw new BadRequestException('accountId missing');

    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
    });
    if (!account) throw new BadRequestException('Account not found');

    const secret = speakeasy.generateSecret({
      name: `NovaSMS (${account.adminEmail})`,
      issuer: 'NovaSMS',
      length: 32,
    }) as { base32: string; otpauth_url: string };

    await this.prisma.account.update({
      where: { id: accountId },
      data: { twoFactorSecret: secret.base32 },
    });

    return {
      success: true,
      secret: secret.base32,
      otpauth_url: secret.otpauth_url,
    };
  }

  async enableTwoFactor(accountId: string, code: string) {
    if (!accountId || !code)
      throw new BadRequestException('accountId and code required');

    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
      select: {
        id: true,
        adminEmail: true,
        twoFactorSecret: true,
      },
    });
    if (!account) throw new BadRequestException('Account not found');

    const secret = account.twoFactorSecret;
    if (!secret) throw new BadRequestException('2FA secret not set');

    const ok = speakeasy.totp.verify({
      secret,
      encoding: 'base32',
      token: code.trim(),
      window: 2,
    });
    if (!ok) throw new UnauthorizedException('Code invalide');

    const backupCodes = this.generateBackupCodes(10);
    const primaryUser = await this.prisma.user.findUnique({
      where: { email: account.adminEmail },
    });

    if (!primaryUser) {
      throw new BadRequestException('Primary user not found');
    }

    await this.prisma.user.update({
      where: { email: primaryUser.email },
      data: { twoFactorEnabled: true },
    });

    await this.prisma.account.update({
      where: { id: account.id },
      data: { backupCodes },
    });

    return {
      success: true,
      message: '2FA activée avec succès',
      backup_codes: backupCodes,
    };
  }

  async disableTwoFactor(accountId: string) {
    if (!accountId) throw new BadRequestException('accountId required');
    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
      select: {
        id: true,
        adminEmail: true,
        twoFactorSecret: true,
      },
    });
    if (!account) throw new BadRequestException('Account not found');

    const primaryUser = await this.prisma.user.findUnique({
      where: { email: account.adminEmail },
    });

    if (!primaryUser) {
      throw new BadRequestException('Primary user not found');
    }

    await this.prisma.user.update({
      where: { email: primaryUser.email },
      data: { twoFactorEnabled: false },
    });

    await this.prisma.account.update({
      where: { id: account.id },
      data: {
        twoFactorSecret: null,
        backupCodes: [],
        twoFactorCode: null,
        twoFactorCodeExpiry: null,
      },
    });
    return { success: true, message: '2FA désactivée' };
  }

  async sendTwoFactorSms(accountId: string, _phone?: string) {
    if (!accountId) throw new BadRequestException('accountId required');
    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
    });
    if (!account) throw new BadRequestException('Account not found');

    const code = randomInt(100000, 1000000).toString();
    const expiry = new Date(Date.now() + 10 * 60 * 1000);

    await this.prisma.account.update({
      where: { id: accountId },
      data: { twoFactorCode: code, twoFactorCodeExpiry: expiry },
    });

    const phone = _phone || null;
    if (phone) {
      try {
        const smsProvider = this.smsProviderFactory.getProvider();
        const result = await smsProvider.send(
          phone,
          `Votre code NovaSMS : ${code}. Valable 10 min.`,
        );
        if (!result.success) {
          throw new Error(result.error || 'SMS provider error');
        }
      } catch (err) {
        // Fail-safe : on logue l'erreur mais on ne bloque pas (évite lock-out)
        this.logger.error(
          `2FA SMS send failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        this.logger.debug(
          `2FA fallback — code for ${account.adminEmail}: ${code}`,
        );
      }
    } else {
      // Aucun numéro connu — mode développement
      this.logger.debug(
        `2FA dev mode — code for ${account.adminEmail}: ${code}`,
      );
    }

    return { success: true, message: 'Code 2FA envoyé' };
  }

  async getAccount(accountId: string) {
    if (!accountId) throw new BadRequestException('accountId required');
    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
      select: {
        id: true,
        adminEmail: true,
        companyName: true,
        creditBalance: true,
        backupCodes: true,
        twoFactorSecret: true,
        onboardingCompleted: true,
        passwordHash: true,
      },
    });
    if (!account) throw new BadRequestException('Account not found');

    const user = await this.getPrimaryUser({
      id: account.id,
      companyName: account.companyName,
      adminEmail: account.adminEmail,
      passwordHash: account.passwordHash,
      sector: null,
      primaryChannels: [],
      emailVerified: true,
      loginAttempts: 0,
      lockedUntil: null,
      twoFactorCode: null,
      twoFactorCodeExpiry: null,
      twoFactorSecret: account.twoFactorSecret,
      backupCodes: account.backupCodes,
      onboardingCompleted: account.onboardingCompleted,
    });

    return {
      success: true,
      account: {
        ...account,
        sector: null,
        primaryChannels: [],
        role: user.role,
        twoFactorEnabled: user.twoFactorEnabled,
      },
    };
  }

  private async getPrimaryUser(
    account: AuthAccount & { passwordHash?: string },
    desiredRole?: UserRole, // ✅ Type enum
  ): Promise<AuthUser> {
    const existingUser = await this.prisma.user.findUnique({
      where: { email: account.adminEmail },
    });

    if (existingUser) {
      if (existingUser.accountId !== account.id) {
        throw new BadRequestException('Primary user does not match account');
      }

      // ✅ Correction: comparaison avec enum
      if (desiredRole && existingUser.role !== desiredRole) {
        return this.prisma.user.update({
          where: { email: account.adminEmail },
          data: { role: desiredRole }, // ✅ Enum UserRole
        });
      }

      return existingUser;
    }

    if (!account.passwordHash) {
      throw new BadRequestException('Primary user not found');
    }

    // ✅ Correction: utiliser UserRole.Admin par défaut
    return this.prisma.user.create({
      data: {
        accountId: account.id,
        email: account.adminEmail,
        passwordHash: account.passwordHash,
        role: desiredRole || UserRole.Admin, // ✅ Enum Prisma
        twoFactorEnabled: false,
      },
    });
  }

  // ✅ Nouvelle méthode: normaliser string → UserRole enum
  private normalizeRoleToEnum(role?: string): UserRole | undefined {
    if (!role) return undefined;

    const value = role.trim().toLowerCase();
    if (!value) return undefined;

    if (value.includes('administr')) return UserRole.Admin;
    if (value.includes('marketing')) return UserRole.Editor; // ou créer UserRole.MarketingManager
    if (
      value.includes('boutique') ||
      value.includes('gérant') ||
      value.includes('gerant')
    ) {
      return UserRole.Editor;
    }

    // Fallback: retourner Admin si la valeur n'est pas reconnue
    return UserRole.Admin;
  }
}
