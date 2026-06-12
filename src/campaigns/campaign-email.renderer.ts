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
              return `<td valign="top" style="padding:4px; width:${100 / layout}%">${nestedHtml || '<div style="height:24px;border:1px dashed #e5e7eb;border-radius:8px;"></div>'}</td>`;
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

export function renderCampaignEmailHtml(
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
