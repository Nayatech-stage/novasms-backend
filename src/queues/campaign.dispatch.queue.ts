import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';

import { Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { EmailProviderFactory } from '../providers/email/email.provider.factory';
import { SmsProviderFactory } from '../providers/sms/sms.provider.factory';
import { WhatsappProviderFactory } from '../providers/whatsapp/whatsapp.provider.factory';
import {
  createTrackingToken,
  getTrackingBaseUrl,
} from '../track/track-token.util';
import {
  CampaignStatus,
  CampaignVariant,
  SendStatus,
  SendVariant,
} from '@prisma/client';

export interface DispatchCampaignJob {
  campaignId: string;
  chunkSize?: number;
  cursor?: string | null;
  variant?: 'A' | 'B';
  remainingContacts?: boolean;
}

export interface EvaluateABWinnerJob {
  campaignId: string;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function resolveCampaignImagePublicBaseUrl(): string | null {
  const rawBaseUrl =
    process.env.CAMPAIGN_IMAGE_PUBLIC_BASE_URL?.trim() ||
    process.env.S3_ENDPOINT?.trim() ||
    process.env.CAMPAIGN_IMAGE_S3_ENDPOINT?.trim();

  if (!rawBaseUrl) {
    return null;
  }

  const cleanedBaseUrl = rawBaseUrl.replace(/\/$/, '');
  const bucketName = process.env.CAMPAIGN_IMAGE_BUCKET?.trim();

  if (!bucketName || cleanedBaseUrl.endsWith(`/${bucketName}`)) {
    return cleanedBaseUrl;
  }

  return `${cleanedBaseUrl}/${bucketName}`;
}

function extractCampaignImageFileName(src: string): string | null {
  const cleanSrc = src.split('#')[0]?.split('?')[0] || src;
  const fileName = cleanSrc.split('/').filter(Boolean).pop();
  return fileName || null;
}

function shouldRewriteCampaignImageSource(src: string): boolean {
  if (!src || src.startsWith('data:') || src.startsWith('cid:')) {
    return false;
  }

  if (src.startsWith('/')) {
    return true;
  }

  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//i.test(src);
}

function rewriteCampaignImageSource(src: string): string {
  if (!shouldRewriteCampaignImageSource(src)) {
    return src;
  }

  const publicBaseUrl = resolveCampaignImagePublicBaseUrl();
  const fileName = extractCampaignImageFileName(src);

  if (!publicBaseUrl || !fileName) {
    return src;
  }

  return `${publicBaseUrl}/${fileName}`;
}

function rewriteCampaignEmailHtmlImageSources(html: string): string {
  return html.replace(
    /(<img\b[^>]*\bsrc=)(["'])([^"']+)(\2)/gi,
    (_match, prefix: string, quote: string, src: string) => {
      return `${prefix}${quote}${escapeHtml(rewriteCampaignImageSource(src))}${quote}`;
    },
  );
}

function rewriteTrackedAnchors(html: string, sendId: string): string {
  const token = createTrackingToken(sendId);
  const trackingBaseUrl = getTrackingBaseUrl();

  return html.replace(
    /(<a\b[^>]*\bhref=)(["'])([^"']+)(\2)/gi,
    (_match, prefix: string, quote: string, href: string) => {
      if (!/^https?:\/\//i.test(href)) {
        return `${prefix}${quote}${escapeHtml(href)}${quote}`;
      }

      if (/\/track\/click\?/i.test(href)) {
        return `${prefix}${quote}${escapeHtml(href)}${quote}`;
      }

      const trackedHref = `${trackingBaseUrl}/track/click?sendId=${encodeURIComponent(sendId)}&url=${encodeURIComponent(href)}&t=${encodeURIComponent(token)}`;
      return `${prefix}${quote}${escapeHtml(trackedHref)}${quote}`;
    },
  );
}

function injectOpenTrackingPixel(html: string, sendId: string): string {
  const token = createTrackingToken(sendId);
  const trackingBaseUrl = getTrackingBaseUrl();
  const pixelUrl = `${trackingBaseUrl}/track/open?sendId=${encodeURIComponent(sendId)}&t=${encodeURIComponent(token)}`;
  const pixelTag = `<img src="${escapeHtml(pixelUrl)}" width="1" height="1" style="display:none;" alt=""/>`;

  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${pixelTag}</body>`);
  }

  return `${html}${pixelTag}`;
}

function applyTrackingToEmailHtml(html: string, sendId: string): string {
  const rewrittenAnchors = rewriteTrackedAnchors(html, sendId);
  return injectOpenTrackingPixel(rewrittenAnchors, sendId);
}

function normalizeSmsPhoneNumber(phone: string): string | null {
  const cleaned = phone.replace(/[\s().-]/g, '').trim();

  if (/^\+\d{8,15}$/.test(cleaned)) {
    return cleaned;
  }

  if (/^00\d{8,15}$/.test(cleaned)) {
    const normalized = `+${cleaned.slice(2)}`;
    return /^\+\d{8,15}$/.test(normalized) ? normalized : null;
  }

  if (/^\d{8,15}$/.test(cleaned)) {
    return `+${cleaned}`;
  }

  return null;
}

function personalizeText(
  value: string,
  context: {
    firstName?: string;
    lastName?: string;
    fullName?: string;
    email?: string;
    phone?: string;
    companyName?: string;
    promoCode?: string;
  },
): string {
  const safeFullName =
    context.fullName ||
    [context.firstName, context.lastName].filter(Boolean).join(' ').trim();

  return value
    .replace(/\{\{(?:pr[eé]nom|firstName)\}\}/gi, context.firstName || '')
    .replace(/\{\{(?:nom|lastName|surname)\}\}/gi, context.lastName || '')
    .replace(/\{\{(?:fullName|nomComplet|name)\}\}/gi, safeFullName || '')
    .replace(/\{\{(?:email|e-mail)\}\}/gi, context.email || '')
    .replace(/\{\{(?:phone|tel|telephone)\}\}/gi, context.phone || '')
    .replace(
      /\{\{(?:shopName|boutique|nomBoutique)\}\}/gi,
      context.companyName || '',
    )
    .replace(/\{\{(?:promoCode|code_promo)\}\}/gi, context.promoCode || '');
}

function renderEmailBlock(
  block: Record<string, unknown>,
  context: {
    firstName?: string;
    lastName?: string;
    fullName?: string;
    email?: string;
    phone?: string;
    companyName?: string;
    promoCode?: string;
  },
): string {
  const type = typeof block.type === 'string' ? block.type : '';
  const content = asRecord(block.content) || {};

  if (type === 'text') {
    const text = personalizeText(
      typeof content.text === 'string' ? content.text : '',
      context,
    );
    const fontSize =
      typeof content.fontSize === 'number' ? `${content.fontSize}px` : '14px';
    const fontWeight =
      typeof content.fontWeight === 'number' ? content.fontWeight : 400;
    const textAlign =
      content.textAlign === 'center' ||
      content.textAlign === 'right' ||
      content.textAlign === 'justify'
        ? content.textAlign
        : 'left';
    const color = typeof content.color === 'string' ? content.color : '#111827';

    return `<p style="margin:0 0 12px; font-size:${fontSize}; font-weight:${fontWeight}; text-align:${textAlign}; color:${color}; line-height:1.5;">${escapeHtml(text).replaceAll('\n', '<br/>')}</p>`;
  }

  if (type === 'image') {
    const src = typeof content.src === 'string' ? content.src : '';
    const alt = typeof content.alt === 'string' ? content.alt : 'Image';
    if (!src) return '';
    return `<div style="margin:0 0 12px;"><img src="${escapeHtml(rewriteCampaignImageSource(src))}" alt="${escapeHtml(alt)}" style="max-width:100%; width:100%; height:auto; display:block; border:0; border-radius:12px;"/></div>`;
  }

  if (type === 'button') {
    const label = personalizeText(
      typeof content.text === 'string' && content.text.trim()
        ? content.text
        : 'Bouton',
      context,
    );
    const url = personalizeText(
      typeof content.url === 'string' ? content.url : '',
      context,
    );
    if (!url) return '';
    return `<div style="margin:16px 0;"><a href="${escapeHtml(url)}" style="display:inline-block; background:#2EC80A; color:#fff; padding:12px 20px; text-decoration:none; border-radius:8px; font-weight:700;">${escapeHtml(label)}</a></div>`;
  }

  if (type === 'divider') {
    return '<hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0;" />';
  }

  if (type === 'spacing') {
    const size = typeof content.size === 'string' ? content.size : 'medium';
    const height =
      size === 'small'
        ? 8
        : size === 'large'
          ? 24
          : size === 'extra-large'
            ? 32
            : 16;
    return `<div style="height:${height}px;"></div>`;
  }

  if (type === 'html') {
    return typeof content.html === 'string'
      ? rewriteCampaignEmailHtmlImageSources(content.html)
      : '';
  }

  if (type === 'product') {
    const title = personalizeText(
      typeof content.title === 'string' ? content.title : 'Produit',
      context,
    );
    const description = personalizeText(
      typeof content.description === 'string' ? content.description : '',
      context,
    );
    const price = personalizeText(
      typeof content.price === 'string' ? content.price : '',
      context,
    );
    const image = typeof content.image === 'string' ? content.image : '';
    const url = personalizeText(
      typeof content.url === 'string' ? content.url : '',
      context,
    );

    return `
      <table role="presentation" width="100%" style="border-collapse:collapse; margin:0 0 12px; border:1px solid #e5e7eb; border-radius:12px; overflow:hidden;">
        <tr>
          <td style="padding:0;">
            ${image ? `<img src="${escapeHtml(rewriteCampaignImageSource(image))}" alt="${escapeHtml(title)}" style="width:100%; max-width:100%; display:block; height:auto;"/>` : ''}
          </td>
        </tr>
        <tr>
          <td style="padding:16px; font-family:Arial,sans-serif;">
            <div style="display:flex; justify-content:space-between; gap:12px; align-items:flex-start; margin-bottom:8px;">
              <strong style="font-size:16px; color:#111827;">${escapeHtml(title)}</strong>
              ${price ? `<span style="font-size:14px; font-weight:700; color:#2EC80A; white-space:nowrap;">${escapeHtml(price)}</span>` : ''}
            </div>
            ${description ? `<p style="margin:0 0 12px; font-size:14px; color:#4b5563; line-height:1.5;">${escapeHtml(description).replaceAll('\n', '<br/>')}</p>` : ''}
            ${url ? `<a href="${escapeHtml(url)}" style="display:inline-block; background:#2EC80A; color:#fff; padding:10px 16px; text-decoration:none; border-radius:8px; font-weight:700;">Voir le produit</a>` : ''}
          </td>
        </tr>
      </table>
    `;
  }

  if (type === 'columns') {
    const layout = [1, 2, 3].includes(Number(content.layout || 2))
      ? Number(content.layout || 2)
      : 2;
    const columns = Array.isArray(content.columns)
      ? (content.columns as Array<Record<string, unknown>>)
      : [];

    return `
      <table role="presentation" width="100%" style="border-collapse:collapse; margin:0 0 12px;">
        <tr>
          ${Array.from({ length: layout })
            .map((_, index) => {
              const column = columns[index];
              const nestedBlocks = Array.isArray(column?.blocks)
                ? (column.blocks as Array<Record<string, unknown>>)
                : [];
              const nestedHtml = nestedBlocks
                .map((nested) => renderEmailBlock(nested, context))
                .join('');
              return `<td valign="top" style="padding:4px; width:${100 / layout}%;">${nestedHtml || '<div style="height:24px;border:1px dashed #e5e7eb;border-radius:8px;"></div>'}</td>`;
            })
            .join('')}
        </tr>
      </table>
    `;
  }

  if (type === 'social') {
    const links = [
      { id: 'facebook', label: 'Facebook', color: '#1877F2' },
      { id: 'instagram', label: 'Instagram', color: '#E4405F' },
      { id: 'tiktok', label: 'TikTok', color: '#000000' },
      { id: 'linkedin', label: 'LinkedIn', color: '#0A66C2' },
    ]
      .map((network) => {
        const url =
          typeof content[network.id] === 'string'
            ? (content[network.id] as string)
            : '';
        if (!url) return '';
        return `<a href="${escapeHtml(url)}" style="display:inline-block; margin-right:8px; color:${network.color}; text-decoration:none; font-weight:700;">${network.label}</a>`;
      })
      .join('');

    return links ? `<p style="margin:12px 0;">${links}</p>` : '';
  }

  return '';
}

function renderEmailHtml(
  contentJson: unknown,
  fallbackText: string,
  context: {
    firstName?: string;
    lastName?: string;
    fullName?: string;
    email?: string;
    phone?: string;
    companyName?: string;
    promoCode?: string;
  },
): string {
  const body = asRecord(contentJson);
  const blocks = Array.isArray(body?.blocks)
    ? (body?.blocks as Array<Record<string, unknown>>)
    : [];

  if (blocks.length === 0) {
    return `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;">${escapeHtml(fallbackText || '')}</div>`;
  }

  const preheader = typeof body?.preheader === 'string' ? body.preheader : '';
  const subject = typeof body?.subject === 'string' ? body.subject : 'NovaSMS';
  const renderedBlocks = blocks
    .map((block) => renderEmailBlock(block, context))
    .join('');

  return `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#ffffff;color:#111827;">
      <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader || subject)}</div>
      ${renderedBlocks}
    </div>
  `;
}

function resolveVariantABConfig(contentJson: unknown, variant?: 'A' | 'B') {
  if (!variant) return undefined;
  const body = asRecord(contentJson);
  const abTestConfig = asRecord(body?.abTestConfig);
  if (!abTestConfig) return undefined;

  const variantKey = variant === 'B' ? 'variantB' : 'variantA';
  return asRecord(abTestConfig[variantKey]);
}

function buildVariantEmailContentJson(
  contentJson: unknown,
  variantConfig: Record<string, unknown> | undefined,
  fallbackSubject: string,
) {
  if (!variantConfig) return contentJson;
  const emailHtml =
    typeof variantConfig.emailHtml === 'string'
      ? variantConfig.emailHtml.trim()
      : '';
  if (!emailHtml) return contentJson;

  const base = asRecord(contentJson) || {};
  const subject =
    typeof variantConfig.emailSubject === 'string' &&
    variantConfig.emailSubject.trim().length > 0
      ? variantConfig.emailSubject
      : fallbackSubject;

  return {
    ...base,
    subject,
    blocks: [{ type: 'html', content: { html: emailHtml } }],
  };
}

@Processor('campaign-dispatch')
export class CampaignDispatchProcessor extends WorkerHost {
  private readonly logger = new Logger(CampaignDispatchProcessor.name);

  constructor(
    private prisma: PrismaService,
    @InjectQueue('campaign-dispatch') private dispatchQueue: Queue,
    private mailService: MailService,
    private emailProviderFactory: EmailProviderFactory,
    private smsProviderFactory: SmsProviderFactory,
    private whatsappProviderFactory: WhatsappProviderFactory,
  ) {
    super();
  }

  async process(job: Job<DispatchCampaignJob>) {
    if (job.name === 'evaluate-ab-winner') {
      return this.handleEvaluateABWinner(job as Job<EvaluateABWinnerJob>);
    }
    if (job.name === 'dispatch-winner') {
      return this.handleWinnerDispatch(
        job as Job<{ campaignId: string; variant: 'A' | 'B' }>,
      );
    }
    return this.handleDispatch(job);
  }

  async handleDispatch(job: Job<DispatchCampaignJob>) {
    const {
      campaignId,
      chunkSize = 500,
      cursor,
      variant,
      remainingContacts = false,
    } = job.data;

    this.logger.log(
      `Dispatching campaign ${campaignId}${variant ? ` (variant ${variant})` : ''}${remainingContacts ? ' to remaining contacts' : ''}`,
    );

    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      include: {
        account: {
          select: { id: true, companyName: true },
        },
        segment: {
          select: { id: true, name: true, type: true, criteria: true },
        },
      },
    });

    if (!campaign) return { success: false, error: 'Campaign not found' };
    if (campaign.status === CampaignStatus.CANCELLED)
      return { success: false, reason: 'cancelled' };
    if (
      campaign.status !== CampaignStatus.SENDING &&
      campaign.status !== CampaignStatus.SCHEDULED
    ) {
      return { success: false, error: 'Invalid status' };
    }

    const pendingWhere = {
      campaignId,
      status: SendStatus.PENDING,
      ...(variant
        ? {
            variant: remainingContacts
              ? SendVariant.NONE
              : (variant as SendVariant),
          }
        : {}),
    };

    const sends = await this.prisma.send.findMany({
      where: pendingWhere,
      take: chunkSize,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      orderBy: { id: 'asc' },
      include: {
        contact: {
          select: {
            id: true,
            email: true,
            phone: true,
            firstName: true,
            lastName: true,
            optOut: true,
          },
        },
      },
    });

    if (sends.length === 0) {
      const remainingPending = await this.prisma.send.count({
        where: {
          campaignId,
          status: SendStatus.PENDING,
        },
      });
      if (remainingPending === 0) {
        // Use updateMany to avoid throwing if the campaign was deleted concurrently
        await this.prisma.campaign.updateMany({
          where: { id: campaignId },
          data: { status: CampaignStatus.SENT },
        });
      }
      return { success: true, sent: 0, campaignId };
    }

    const results = await Promise.allSettled(
      sends.map(async (sendRecord) => {
        try {
          const { contact } = sendRecord;
          if (contact.optOut) {
            await this.prisma.send.update({
              where: { id: sendRecord.id },
              data: {
                status: SendStatus.UNSUBSCRIBED,
                variant: remainingContacts
                  ? (variant as SendVariant)
                  : sendRecord.variant,
              },
            });
            return { success: false };
          }

          const contactContext = {
            firstName: contact.firstName || undefined,
            lastName: contact.lastName || undefined,
            fullName:
              [contact.firstName, contact.lastName]
                .filter(Boolean)
                .join(' ')
                .trim() || undefined,
            email: contact.email || undefined,
            phone: contact.phone || undefined,
            companyName: campaign.account?.companyName || undefined,
            promoCode: campaign.promoCode || undefined,
          };

          const content = personalizeText(
            campaign.content || '',
            contactContext,
          );

          const effectiveVariant = remainingContacts
            ? variant
            : sendRecord.variant === SendVariant.B
              ? 'B'
              : sendRecord.variant === SendVariant.A
                ? 'A'
                : undefined;
          const subject =
            effectiveVariant === 'B'
              ? campaign.subjectB || campaign.subject || ''
              : effectiveVariant === 'A'
                ? campaign.subjectA || campaign.subject || ''
                : campaign.subject || '';
          const variantConfig = resolveVariantABConfig(
            campaign.contentJson,
            effectiveVariant,
          );
          const smsVariantMessage =
            typeof variantConfig?.smsMessage === 'string'
              ? variantConfig.smsMessage
              : undefined;
          const smsContent = smsVariantMessage
            ? personalizeText(smsVariantMessage, contactContext)
            : content;
          const variantEmailContentJson = buildVariantEmailContentJson(
            campaign.contentJson,
            variantConfig,
            subject,
          );
          const personalizedSubject = personalizeText(subject, {
            firstName: contact.firstName || undefined,
            lastName: contact.lastName || undefined,
            fullName:
              [contact.firstName, contact.lastName]
                .filter(Boolean)
                .join(' ')
                .trim() || undefined,
            email: contact.email || undefined,
            phone: contact.phone || undefined,
            companyName: campaign.account?.companyName || undefined,
            promoCode: campaign.promoCode || undefined,
          });

          if (campaign.channelType === 'SMS') {
            if (!contact.phone) {
              throw new Error('Contact phone missing');
            }
            const normalizedPhone = normalizeSmsPhoneNumber(contact.phone);
            if (!normalizedPhone) {
              throw new Error('Contact phone invalid');
            }
            await this.sendSms(normalizedPhone, smsContent);
          } else if (campaign.channelType === 'WhatsApp') {
            // US: Canal WhatsApp end-to-end
            if (!contact.phone) {
              throw new Error('Contact phone missing for WhatsApp');
            }
            const normalizedPhone = normalizeSmsPhoneNumber(contact.phone);
            if (!normalizedPhone) {
              throw new Error('Contact phone invalid for WhatsApp');
            }
            await this.sendWhatsApp(normalizedPhone, smsContent);
          } else {
            if (!contact.email) {
              throw new Error('Contact email missing');
            }
            await this.sendEmail(
              contact.email,
              personalizedSubject,
              variantEmailContentJson,
              content,
              contactContext,
              sendRecord.id,
            );
          }

          await this.prisma.send.update({
            where: { id: sendRecord.id },
            data: {
              status: SendStatus.SENT,
              variant: remainingContacts
                ? (variant as SendVariant)
                : sendRecord.variant,
              sentAt: new Date(),
            },
          });

          // US-016 – Atomic credit deduction per successful send
          await this.deductSendCredit(campaign.accountId, campaign);

          return { success: true };
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          await this.prisma.send.update({
            where: { id: sendRecord.id },
            data: {
              status: SendStatus.BOUNCED,
              variant: remainingContacts
                ? (variant as SendVariant)
                : sendRecord.variant,
              sentAt: new Date(),
              bouncedReason: errMsg,
            },
          });
          return { success: false };
        }
      }),
    );

    const successCount = results.filter(
      (r): r is PromiseFulfilledResult<{ success: boolean }> =>
        r.status === 'fulfilled' && r.value.success,
    ).length;
    const nextCursor = sends[sends.length - 1]?.id || null;

    await this.prisma.campaign.update({
      where: { id: campaignId },
      data: {
        sentCount: { increment: successCount },
        failedCount: { increment: results.length - successCount },
      },
    });

    const remainingPending = await this.prisma.send.count({
      where: {
        campaignId,
        status: SendStatus.PENDING,
      },
    });

    if (remainingPending === 0) {
      await this.prisma.campaign.updateMany({
        where: { id: campaignId },
        data: { status: CampaignStatus.SENT },
      });
    }

    if (sends.length === chunkSize) {
      await this.dispatchQueue.add(
        'dispatch-campaign',
        {
          campaignId,
          chunkSize,
          cursor: nextCursor,
          variant,
          remainingContacts,
        },
        {
          jobId: `dispatch-${campaignId}-${variant || 'all'}-${remainingContacts ? 'remaining' : 'direct'}-${nextCursor}`,
          removeOnComplete: true,
        },
      );
    }

    // ✅ Send notification email when campaign dispatch completes
    if (successCount > 0) {
      try {
        const campaign = await this.prisma.campaign.findUnique({
          where: { id: campaignId },
          include: { account: { select: { adminEmail: true } } },
        });
        if (campaign?.account) {
          await this.mailService.sendCampaignSentNotification(
            campaign.account.adminEmail,
            {
              campaignName: campaign.name,
              channelType: campaign.channelType,
              sentAt: new Date(),
            },
          );
        }
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        this.logger.error(
          `Failed to send notification for campaign ${campaignId}: ${errMsg}`,
        );
      }
    }

    return {
      success: true,
      sent: successCount,
      total: results.length,
      nextCursor,
      campaignId,
    };
  }

  async handleEvaluateABWinner(job: Job<EvaluateABWinnerJob>) {
    const { campaignId } = job.data;
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      include: {
        sends: {
          select: {
            status: true,
            variant: true,
            openedAt: true,
            clickedAt: true,
          },
        },
      },
    });

    if (!campaign || !campaign.subjectB) {
      return { success: false, reason: 'not-ab-campaign' };
    }

    if (campaign.abWinner) {
      return {
        success: true,
        reason: 'winner-already-set',
        winner: campaign.abWinner,
      };
    }

    const sentStatuses: SendStatus[] = [
      SendStatus.SENT,
      SendStatus.OPENED,
      SendStatus.CLICKED,
    ];

    const statsA = campaign.sends.filter(
      (s) => s.variant === SendVariant.A && sentStatuses.includes(s.status),
    );
    const statsB = campaign.sends.filter(
      (s) => s.variant === SendVariant.B && sentStatuses.includes(s.status),
    );

    if (statsA.length === 0 && statsB.length === 0) {
      return { success: false, reason: 'not-enough-data' };
    }

    const openRateA =
      statsA.length > 0
        ? statsA.filter((s) => Boolean(s.openedAt)).length / statsA.length
        : 0;
    const openRateB =
      statsB.length > 0
        ? statsB.filter((s) => Boolean(s.openedAt)).length / statsB.length
        : 0;
    const clickRateA =
      statsA.length > 0
        ? statsA.filter((s) => Boolean(s.clickedAt)).length / statsA.length
        : 0;
    const clickRateB =
      statsB.length > 0
        ? statsB.filter((s) => Boolean(s.clickedAt)).length / statsB.length
        : 0;

    // Fallback strategy: click rate first, then open rate.
    const winner: CampaignVariant =
      clickRateB > clickRateA ||
      (clickRateB === clickRateA && openRateB > openRateA)
        ? 'B'
        : 'A';

    await this.prisma.campaign.update({
      where: { id: campaignId },
      data: { abWinner: winner },
    });

    await this.prisma.aBTestResult.upsert({
      where: { campaignId_variant: { campaignId, variant: 'A' } },
      update: {
        sentCount: statsA.length,
        openedCount: statsA.filter((s) => Boolean(s.openedAt)).length,
        clickedCount: statsA.filter((s) => Boolean(s.clickedAt)).length,
        evaluatedAt: new Date(),
      },
      create: {
        campaignId,
        variant: 'A',
        sentCount: statsA.length,
        openedCount: statsA.filter((s) => Boolean(s.openedAt)).length,
        clickedCount: statsA.filter((s) => Boolean(s.clickedAt)).length,
        evaluatedAt: new Date(),
      },
    });

    await this.prisma.aBTestResult.upsert({
      where: { campaignId_variant: { campaignId, variant: 'B' } },
      update: {
        sentCount: statsB.length,
        openedCount: statsB.filter((s) => Boolean(s.openedAt)).length,
        clickedCount: statsB.filter((s) => Boolean(s.clickedAt)).length,
        evaluatedAt: new Date(),
      },
      create: {
        campaignId,
        variant: 'B',
        sentCount: statsB.length,
        openedCount: statsB.filter((s) => Boolean(s.openedAt)).length,
        clickedCount: statsB.filter((s) => Boolean(s.clickedAt)).length,
        evaluatedAt: new Date(),
      },
    });

    const remainingCount = await this.prisma.send.count({
      where: {
        campaignId,
        status: SendStatus.PENDING,
        variant: SendVariant.NONE,
      },
    });

    if (remainingCount > 0) {
      await this.dispatchQueue.add(
        'dispatch-winner',
        {
          campaignId,
          variant: winner,
          remainingContacts: true,
        },
        {
          jobId: `dispatch-winner-${campaignId}-${winner}`,
          removeOnComplete: true,
        },
      );
    }

    return {
      success: true,
      campaignId,
      winner,
      openRateA,
      openRateB,
      clickRateA,
      clickRateB,
      remainingCount,
    };
  }

  async handleWinnerDispatch(
    job: Job<{ campaignId: string; variant: 'A' | 'B' }>,
  ) {
    return this.handleDispatch({
      data: { ...job.data, chunkSize: 500, remainingContacts: true },
    } as unknown as Job<DispatchCampaignJob>);
  }

  /**
   * US-016 – Deduct one send's credit from the account balance.
   *
   * Cost per send:
   *   1. campaign.estimatedCost / campaign.estimatedRecipients  (when both are set)
   *   2. env CREDIT_COST_PER_SMS / CREDIT_COST_PER_EMAIL       (fallback)
   *   3. 0  (if no cost information is available)
   *
   * Uses atomic SQL to prevent balance from going below zero:
   *   UPDATE accounts SET credit_balance = credit_balance - cost
   *   WHERE id = ? AND credit_balance >= cost
   *
   * If the account has insufficient credits the send is recorded but a warning
   * is logged (fail-open so the campaign is not interrupted mid-flight).
   */
  private async deductSendCredit(
    accountId: string,
    campaign: {
      estimatedCost: unknown;
      estimatedRecipients: number;
      channelType: string;
    },
  ): Promise<void> {
    let costPerSend = 0;

    const estCost = Number(campaign.estimatedCost ?? 0);
    const estRecipients = campaign.estimatedRecipients || 0;

    if (estCost > 0 && estRecipients > 0) {
      costPerSend = estCost / estRecipients;
    } else {
      const envKey =
        campaign.channelType === 'SMS'
          ? 'CREDIT_COST_PER_SMS'
          : 'CREDIT_COST_PER_EMAIL';
      costPerSend = parseFloat(process.env[envKey] || '0');
    }

    if (costPerSend <= 0) return;

    // Atomic check-and-decrement — prevents negative balance
    const result = await this.prisma.$executeRaw`
      UPDATE accounts
      SET    credit_balance = credit_balance - ${costPerSend}::decimal
      WHERE  id = ${accountId}::uuid
      AND    credit_balance >= ${costPerSend}::decimal
    `;

    if (result === 0) {
      this.logger.warn(
        `Account ${accountId} has insufficient credits for send (need ${costPerSend}).`,
      );
    }
  }

  private async sendWhatsApp(phone: string, content: string) {
    try {
      const provider = this.whatsappProviderFactory.getProvider();
      const result = await provider.send(phone, content);
      if (!result.success) {
        const isPermanent = /invalid|blacklisted|unsubscribed|opt.?out/i.test(
          result.error || '',
        );
        if (isPermanent) {
          this.logger.warn(
            `WhatsApp permanent failure to ${phone}: ${result.error}`,
          );
          return;
        }
        throw new Error(result.error || 'WhatsApp provider send failed');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const isTransient = /rate.limit|timeout|503|429|network|ETIMEDOUT/i.test(
        msg,
      );
      this.logger.error(
        `WhatsApp send to ${phone} failed (${isTransient ? 'transient' : 'permanent'}): ${msg}`,
      );
      if (isTransient) throw err;
    }
  }

  private async sendSms(phone: string, content: string, sendId?: string) {
    try {
      const provider = this.smsProviderFactory.getProvider();
      const result = await provider.send(phone, content);

      if (!result.success) {
        const isPermanent =
          /invalid|blacklisted|unsubscribed|opt.?out|unreachable/i.test(
            result.error || '',
          );
        if (isPermanent) {
          // erreur permanente — ne pas relancer
          this.logger.warn(
            `SMS permanent failure to ${phone}: ${result.error}`,
          );
          return; // retourner sans throw pour ne pas retriggerer le job
        }
        throw new Error(result.error || 'SMS provider send failed');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const isTransient = /rate.limit|timeout|503|429|network|ETIMEDOUT/i.test(
        msg,
      );
      this.logger.error(
        `SMS send to ${phone} failed (${isTransient ? 'transient' : 'permanent'}): ${msg}`,
      );
      if (isTransient) throw err; // BullMQ retry
      // erreur permanente — on logue sans relancer
    }
  }

  private async sendEmail(
    email: string,
    subject: string,
    contentJson: unknown,
    fallbackText: string,
    context: {
      firstName?: string;
      lastName?: string;
      fullName?: string;
      email?: string;
      phone?: string;
      companyName?: string;
      promoCode?: string;
    },
    sendId: string,
  ) {
    const provider = this.emailProviderFactory.getProvider();
    const renderedHtml = renderEmailHtml(contentJson, fallbackText, context);
    const html = applyTrackingToEmailHtml(renderedHtml, sendId);
    const result = await provider.send(email, subject, html);

    if (!result.success) {
      throw new Error(result.error || 'Email provider send failed');
    }
  }
}
