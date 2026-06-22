import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { EmailProviderFactory } from '../providers/email/email.provider.factory';

export const API_PERMISSIONS = [
  'contacts:read',
  'contacts:write',
  'sms:send',
  'email:send',
  'campaigns:read',
  'balance:read',
] as const;

export type ApiPermission = (typeof API_PERMISSIONS)[number];

function hashKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

function generateRawKey(): string {
  return 'nvsms_' + randomBytes(30).toString('hex');
}

@Injectable()
export class ApiKeysService {
  constructor(
    private prisma: PrismaService,
    private emailFactory: EmailProviderFactory,
  ) {}

  async listKeys(accountId: string) {
    return this.prisma.apiKey.findMany({
      where: { accountId, revokedAt: null },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        keySuffix: true,
        permissions: true,
        lastUsedAt: true,
        expiresAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createKey(
    accountId: string,
    name: string,
    permissions: ApiPermission[],
    expiresAt?: Date,
  ) {
    const activeCount = await this.prisma.apiKey.count({
      where: { accountId, revokedAt: null },
    });
    if (activeCount >= 10) {
      throw new BadRequestException(
        'Limite atteinte : maximum 10 clés API actives par compte. Révoquez une clé existante pour en créer une nouvelle.',
      );
    }

    if (expiresAt && expiresAt <= new Date()) {
      throw new BadRequestException(
        "La date d'expiration doit être dans le futur",
      );
    }

    const raw = generateRawKey();
    const keyHash = hashKey(raw);
    const keyPrefix = raw.slice(0, 10);
    const keySuffix = raw.slice(-4);

    await this.prisma.apiKey.create({
      data: {
        accountId,
        name,
        keyHash,
        keyPrefix,
        keySuffix,
        permissions,
        expiresAt,
      },
    });

    return { key: raw, keyPrefix, keySuffix, name, permissions, expiresAt };
  }

  async revokeKey(accountId: string, id: string) {
    const key = await this.prisma.apiKey.findUnique({ where: { id } });
    if (!key) throw new NotFoundException('Clé introuvable');
    if (key.accountId !== accountId)
      throw new ForbiddenException('Non autorisé');
    if (key.revokedAt) throw new ForbiddenException('Clé déjà révoquée');

    await this.prisma.apiKey.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
    return { success: true };
  }

  async getKeyStats(accountId: string, keyId: string) {
    const key = await this.prisma.apiKey.findUnique({ where: { id: keyId } });
    if (!key || key.accountId !== accountId) return null;

    const now = new Date();
    const startOfDay = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      totalCalls,
      callsToday,
      callsThisMonth,
      creditsThisMonth,
      recentLogs,
    ] = await Promise.all([
      this.prisma.apiKeyLog.count({ where: { apiKeyId: keyId } }),
      this.prisma.apiKeyLog.count({
        where: { apiKeyId: keyId, createdAt: { gte: startOfDay } },
      }),
      this.prisma.apiKeyLog.count({
        where: { apiKeyId: keyId, createdAt: { gte: startOfMonth } },
      }),
      this.prisma.apiKeyLog.aggregate({
        where: { apiKeyId: keyId, createdAt: { gte: startOfMonth } },
        _sum: { creditsUsed: true },
      }),
      this.prisma.apiKeyLog.findMany({
        where: { apiKeyId: keyId },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          endpoint: true,
          method: true,
          statusCode: true,
          creditsUsed: true,
          createdAt: true,
        },
      }),
    ]);

    return {
      totalCalls,
      callsToday,
      callsThisMonth,
      creditsThisMonth: Number(creditsThisMonth._sum.creditsUsed ?? 0),
      recentLogs,
    };
  }

  async sendKeyToDeveloper(
    accountId: string,
    dto: { developerEmail: string; fullKey: string; keyName: string },
  ) {
    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
      select: { companyName: true, adminEmail: true },
    });
    const companyName = account?.companyName ?? 'Un utilisateur NovaSMS';

    const provider = this.emailFactory.getProvider();
    const result = await provider.send(
      dto.developerEmail,
      `Clé API NovaSMS — ${companyName}`,
      `
<!DOCTYPE html>
<html lang="fr">
<body style="font-family:sans-serif;max-width:580px;margin:0 auto;padding:24px;color:#1e293b;">
  <div style="background:#3b82f6;border-radius:8px 8px 0 0;padding:20px 24px;">
    <span style="color:#fff;font-size:20px;font-weight:700;">NovaSMS</span>
  </div>
  <div style="border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;padding:28px 24px;">
    <p style="font-size:16px;font-weight:600;margin:0 0 12px;">Bonjour,</p>
    <p style="margin:0 0 16px;color:#475569;">
      <strong>${companyName}</strong> vous a transmis une clé API NovaSMS
      pour intégrer leurs envois de messages SMS et emails.
    </p>

    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin:20px 0;">
      <p style="margin:0 0 6px;font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">
        Clé API — ${dto.keyName}
      </p>
      <code style="font-size:13px;color:#1e293b;word-break:break-all;display:block;background:#fff;padding:10px;border-radius:4px;border:1px solid #e2e8f0;">
        ${dto.fullKey}
      </code>
      <p style="margin:10px 0 0;font-size:11px;color:#ef4444;font-weight:500;">
        ⚠ Conservez cette clé en sécurité — elle donne accès au compte NovaSMS de votre client.
      </p>
    </div>

    <p style="margin:0 0 8px;color:#475569;font-size:14px;">
      Pour intégrer cette clé dans votre code, consultez la documentation technique :
    </p>
    <a href="https://docs.novasms.app/api"
       style="display:inline-block;background:#3b82f6;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;">
      Voir la documentation →
    </a>

    <hr style="margin:24px 0;border:none;border-top:1px solid #e2e8f0;" />
    <p style="font-size:12px;color:#94a3b8;margin:0;">
      Cette clé a été générée par ${companyName} depuis leur espace NovaSMS.
      Si vous avez reçu cet email par erreur, ignorez-le.
    </p>
  </div>
</body>
</html>
      `.trim(),
    );

    return { sent: result.success, to: dto.developerEmail };
  }

  async validateKey(rawKey: string) {
    const keyHash = hashKey(rawKey);
    const apiKey = await this.prisma.apiKey.findUnique({
      where: { keyHash },
      include: { account: { select: { id: true, creditBalance: true } } },
    });

    if (!apiKey || apiKey.revokedAt) return null;
    if (apiKey.expiresAt && apiKey.expiresAt < new Date()) return null;

    await this.prisma.apiKey
      .update({
        where: { id: apiKey.id },
        data: { lastUsedAt: new Date() },
      })
      .catch(() => {});

    return apiKey;
  }
}
