import { renderCampaignEmailHtml } from './campaign-email.renderer';

describe('renderCampaignEmailHtml — rendu email (US-007)', () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
  });

  const context = {
    firstName: 'Awa',
    lastName: 'Koné',
    email: 'awa@example.ci',
    phone: '+2250700000000',
    companyName: 'Boutique Awa',
    promoCode: 'PROMO10',
  };

  it('retourne le texte fallback échappé quand contentJson est vide', () => {
    const html = renderCampaignEmailHtml(null, 'Bonjour <client>', context);

    expect(html).toContain('Bonjour &lt;client&gt;');
    expect(html).not.toContain('<client>');
  });

  it('remplace les variables {{prénom}}, {{boutique}} et {{code_promo}} (US-007)', () => {
    const html = renderCampaignEmailHtml(
      {
        blocks: [
          {
            type: 'text',
            content: {
              text: 'Bonjour {{prénom}}, bienvenue chez {{boutique}} — code {{code_promo}}',
            },
          },
        ],
      },
      '',
      context,
    );

    expect(html).toContain('Bonjour Awa');
    expect(html).toContain('Boutique Awa');
    expect(html).toContain('PROMO10');
    expect(html).not.toContain('{{');
  });

  it('échappe le HTML injecté dans un bloc texte (anti-XSS)', () => {
    const html = renderCampaignEmailHtml(
      {
        blocks: [
          {
            type: 'text',
            content: { text: '<script>alert("xss")</script>' },
          },
        ],
      },
      '',
      context,
    );

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('rend les blocs image, bouton, divider et html', () => {
    const html = renderCampaignEmailHtml(
      {
        blocks: [
          {
            type: 'image',
            content: {
              src: 'https://cdn.example.com/banner.png',
              alt: 'Bannière',
            },
          },
          {
            type: 'button',
            content: { text: 'Acheter', url: 'https://shop.example.ci' },
          },
          { type: 'divider', content: {} },
          {
            type: 'html',
            content: { html: '<table><tr><td>Custom</td></tr></table>' },
          },
        ],
      },
      '',
      context,
    );

    expect(html).toContain('https://cdn.example.com/banner.png');
    expect(html).toContain('Acheter');
    expect(html).toContain('https://shop.example.ci');
    expect(html).toContain('<table><tr><td>Custom</td></tr></table>');
  });

  it('réécrit les images localhost vers la base publique S3', () => {
    process.env = {
      ...originalEnv,
      S3_ENDPOINT: 'https://storage.novasms.com',
      CAMPAIGN_IMAGE_BUCKET: 'campaigns',
    };
    delete process.env.CAMPAIGN_IMAGE_PUBLIC_BASE_URL;
    delete process.env.CAMPAIGN_IMAGE_S3_ENDPOINT;

    const html = renderCampaignEmailHtml(
      {
        blocks: [
          {
            type: 'image',
            content: { src: 'http://localhost:9000/campaigns/photo.png' },
          },
        ],
      },
      '',
      context,
    );

    expect(html).toContain('https://storage.novasms.com/campaigns/photo.png');
    expect(html).not.toContain('localhost:9000');
  });

  it('inclut le preheader masqué quand fourni', () => {
    const html = renderCampaignEmailHtml(
      {
        preheader: 'Offre spéciale du jour',
        blocks: [{ type: 'text', content: { text: 'Corps' } }],
      },
      '',
      context,
    );

    expect(html).toContain('Offre spéciale du jour');
    expect(html).toContain('display:none');
  });

  it('ignore les blocs de type inconnu sans erreur', () => {
    const html = renderCampaignEmailHtml(
      {
        blocks: [
          { type: 'unknown-block', content: {} },
          { type: 'text', content: { text: 'Visible' } },
        ],
      },
      '',
      context,
    );

    expect(html).toContain('Visible');
  });
});
