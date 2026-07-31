/* eslint-disable */
// Compte de démonstration DÉDIÉ aux captures d'écran du mémoire — indépendant du compte e2e
// (novatest_20260507@example.com) pour ne jamais interférer avec la suite Playwright.
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const speakeasy = require('speakeasy');

async function main() {
  const prisma = new PrismaClient();
  const password = 'DemoMemoire123!';
  const hashed = await bcrypt.hash(password, 12);
  const adminEmail = 'demo.memoire@novasms.dev';

  let account = await prisma.account.findUnique({ where: { adminEmail } });
  const twoFactorSecret = speakeasy.generateSecret({
    length: 20,
    name: 'NovaSMS Demo',
  }).base32;

  if (!account) {
    account = await prisma.account.create({
      data: {
        companyName: 'Boutique Awa — Démo Mémoire',
        adminEmail,
        passwordHash: hashed,
        country: 'CIV',
        creditBalance: 45000,
        emailVerified: true,
        onboardingCompleted: true,
        twoFactorEnabled: true,
        twoFactorSecret,
      },
    });
    console.log('Created demo account', account.id);
  } else {
    account = await prisma.account.update({
      where: { id: account.id },
      data: { twoFactorEnabled: true, twoFactorSecret, creditBalance: 45000 },
    });
    console.log('Demo account exists, updated', account.id);
  }

  // La vérification TOTP au login se fait sur User.twoFactorEnabled (primaryUser), pas Account
  let primaryUser = await prisma.user.findUnique({
    where: { email: adminEmail },
  });
  if (!primaryUser) {
    primaryUser = await prisma.user.create({
      data: {
        accountId: account.id,
        email: adminEmail,
        passwordHash: hashed,
        role: 'Admin',
        twoFactorEnabled: true,
      },
    });
    console.log('Created primary user', primaryUser.id);
  } else {
    primaryUser = await prisma.user.update({
      where: { id: primaryUser.id },
      data: { twoFactorEnabled: true },
    });
    console.log('Primary user exists, updated 2FA', primaryUser.id);
  }

  const demoContacts = [
    {
      firstName: 'Awa',
      lastName: 'Koffi',
      email: 'awa.koffi@example.com',
      phone: '+2250102030405',
      location: 'Abidjan',
      tags: ['VIP', 'Fidèle'],
    },
    {
      firstName: 'Moussa',
      lastName: 'Traoré',
      email: 'moussa.traore@example.com',
      phone: '+2250506070809',
      location: 'Bouaké',
      tags: ['Nouveau'],
    },
    {
      firstName: 'Fatou',
      lastName: 'Diabaté',
      email: 'fatou.diabate@example.com',
      phone: '+2250708091011',
      location: 'Yamoussoukro',
      tags: ['VIP'],
    },
    {
      firstName: 'Ibrahim',
      lastName: 'Ouattara',
      email: 'ibrahim.ouattara@example.com',
      phone: '+2252701020304',
      location: 'San-Pédro',
      tags: ['Prospect'],
    },
    {
      firstName: 'Aminata',
      lastName: 'Bamba',
      email: 'aminata.bamba@example.com',
      phone: '+2250505060708',
      location: 'Abidjan',
      tags: ['Fidèle'],
    },
    {
      firstName: 'Kouassi',
      lastName: 'Yao',
      email: 'kouassi.yao@example.com',
      phone: '+2254507080910',
      location: 'Korhogo',
      tags: [],
    },
    {
      firstName: 'Mariam',
      lastName: 'Cissé',
      email: 'mariam.cisse@example.com',
      phone: '+2256507080910',
      location: 'Man',
      tags: ['VIP', 'Nouveau'],
    },
    {
      firstName: 'Yao',
      lastName: 'Kouadio',
      email: 'yao.kouadio@example.com',
      phone: '+2257708091011',
      location: 'Abidjan',
      tags: ['Fidèle'],
    },
    {
      firstName: 'Adjoua',
      lastName: "N'Guessan",
      email: 'adjoua.nguessan@example.com',
      phone: '+2258708091011',
      location: 'Daloa',
      tags: ['Prospect'],
    },
    {
      firstName: 'Sekou',
      lastName: 'Diarra',
      email: 'sekou.diarra@example.com',
      phone: '+2259708091011',
      location: 'Abidjan',
      tags: ['VIP'],
    },
  ];

  const createdContacts = [];
  for (const c of demoContacts) {
    const existing = await prisma.contact.findFirst({
      where: { accountId: account.id, email: c.email },
    });
    if (existing) {
      // Remonté à "aujourd'hui" pour rester au-dessus des 1500 contacts en masse
      // (createdAt plus ancien) dans la liste triée par date d'ajout décroissante.
      const updated = await prisma.contact.update({
        where: { id: existing.id },
        data: { createdAt: new Date() },
      });
      createdContacts.push(updated);
      continue;
    }
    const created = await prisma.contact.create({
      data: { accountId: account.id, ...c },
    });
    createdContacts.push(created);
  }
  console.log(`${createdContacts.length} contacts nommés prêts`);

  // Volume réaliste pour les captures (listes, pagination, KPIs dashboard) — générés en masse,
  // distincts des 10 contacts nommés ci-dessus qui alimentent le rapport de campagne détaillé.
  const BULK_TARGET = 1500;
  const firstNames = [
    'Aya',
    'Kouamé',
    'Adama',
    'Nafissatou',
    'Bakary',
    'Affoué',
    'Yves',
    'Marthe',
    'Serge',
    'Josiane',
    'Brou',
    'Aïcha',
    'Konan',
    'Rokia',
    'Michel',
    'Épiphanie',
    'Boubacar',
    'Danielle',
    'Assane',
    'Chantal',
    'Zié',
    'Pauline',
    'Lassina',
    'Odette',
    'Karim',
    'Solange',
    'Drissa',
    'Huguette',
    'Vincent',
    'Léontine',
  ];
  const lastNames = [
    'Koné',
    'Bamba',
    'Coulibaly',
    'Kouassi',
    'Diallo',
    'Touré',
    'Kamara',
    'Ouédraogo',
    'Yao',
    "N'Dri",
    'Camara',
    'Zadi',
    'Gbagbo',
    'Konaté',
    'Adou',
    'Assi',
    'Silué',
    'Doumbia',
    'Kouakou',
    'Fofana',
  ];
  const locations = [
    'Abidjan',
    'Bouaké',
    'Yamoussoukro',
    'San-Pédro',
    'Korhogo',
    'Man',
    'Daloa',
    'Gagnoa',
    'Abengourou',
    'Divo',
  ];
  const tagPool = [['VIP'], ['Fidèle'], ['Nouveau'], ['Prospect'], [], []];

  // Nettoie l'ancien format de contacts en masse (contactN.prénom.nom@) s'il subsiste,
  // pour régénérer avec le format actuel (prénom.nomN@, téléphone +22509...).
  await prisma.contact.deleteMany({
    where: { accountId: account.id, email: { startsWith: 'contact' } },
  });

  const existingBulkCount = await prisma.contact.count({
    where: { accountId: account.id, phone: { startsWith: '+22509' } },
  });
  if (existingBulkCount < BULK_TARGET) {
    const toCreate = [];
    for (let i = existingBulkCount; i < BULK_TARGET; i++) {
      const fn = firstNames[i % firstNames.length];
      const ln =
        lastNames[Math.floor(i / firstNames.length) % lastNames.length];
      toCreate.push({
        accountId: account.id,
        firstName: fn,
        lastName: ln,
        email: `${fn.toLowerCase()}.${ln.toLowerCase().replace(/[^a-z]/g, '')}${i}@example.com`,
        phone: `+22509${String(i).padStart(8, '0')}`,
        location: locations[i % locations.length],
        tags: tagPool[i % tagPool.length],
      });
    }
    for (let i = 0; i < toCreate.length; i += 500) {
      await prisma.contact.createMany({
        data: toCreate.slice(i, i + 500),
        skipDuplicates: true,
      });
    }
    console.log(
      `${toCreate.length} contacts en masse créés (total visé ${BULK_TARGET})`,
    );
  } else {
    console.log(`Contacts en masse déjà présents (${existingBulkCount})`);
  }

  // Étale les dates d'ajout des contacts en masse sur les 4 derniers mois (et toujours
  // avant "aujourd'hui") pour que les 10 contacts nommés restent en tête de liste par défaut.
  await prisma.$executeRaw`
    UPDATE contacts
    SET "createdAt" = NOW() - ((1 + (substring(phone from 7)::int % 120)) || ' days')::interval
    WHERE "accountId" = ${account.id} AND phone LIKE '+22509%'
  `;
  console.log(
    `${createdContacts.length} contacts prêts pour le rapport de campagne`,
  );

  const campaignName = 'Promo Fête des Mères — SMS';
  let campaign = await prisma.campaign.findFirst({
    where: { accountId: account.id, name: campaignName },
  });
  if (!campaign) {
    campaign = await prisma.campaign.create({
      data: {
        accountId: account.id,
        name: campaignName,
        channelType: 'SMS',
        content:
          'Bonjour {{prenom}}, -20% sur toute la boutique ce week-end ! Code: MAMAN20. STOP au 21001',
        status: 'SENT',
        sentCount: 480,
        deliveredCount: 468,
        openedCount: 312,
        clickedCount: 96,
        failedCount: 12,
        estimatedRecipients: 480,
        estimatedCost: 5760,
      },
    });
    console.log('Created campaign', campaign.id);
  } else {
    console.log('Campaign exists', campaign.id);
  }

  // Quelques campagnes supplémentaires (statuts/canaux variés) pour que la liste des
  // campagnes ne montre pas un unique résultat lors des captures.
  const extraCampaigns = [
    {
      name: 'Newsletter Juillet — Nouveautés',
      channelType: 'EMAIL',
      subject: 'Les nouveautés du mois chez Boutique Awa',
      content: '<p>Découvrez notre nouvelle collection...</p>',
      status: 'SENT',
      sentCount: 920,
      deliveredCount: 905,
      openedCount: 410,
      clickedCount: 88,
      failedCount: 15,
      estimatedRecipients: 920,
      estimatedCost: 9200,
    },
    {
      name: 'Relance panier abandonné',
      channelType: 'EMAIL',
      subject: 'Il vous reste un article dans votre panier',
      content: '<p>Votre article vous attend toujours...</p>',
      status: 'SCHEDULED',
      scheduledAt: new Date(Date.now() + 2 * 24 * 3600 * 1000),
      estimatedRecipients: 210,
      estimatedCost: 2100,
    },
    {
      name: 'Alerte réassort — Brouillon',
      channelType: 'SMS',
      content:
        'Bonjour {{prenom}}, le produit que vous attendiez est de nouveau disponible !',
      status: 'DRAFT',
      estimatedRecipients: 150,
      estimatedCost: 1800,
    },
  ];
  for (const c of extraCampaigns) {
    const existing = await prisma.campaign.findFirst({
      where: { accountId: account.id, name: c.name },
    });
    if (!existing) {
      await prisma.campaign.create({ data: { accountId: account.id, ...c } });
      console.log('Created extra campaign', c.name);
    }
  }

  // Sends pour quelques contacts (alimente le tableau du rapport)
  const now = Date.now();
  for (let i = 0; i < createdContacts.length; i++) {
    const contact = createdContacts[i];
    const opened = i % 3 !== 0;
    const clicked = i % 4 === 0;
    await prisma.send.upsert({
      where: {
        campaignId_contactId: {
          campaignId: campaign.id,
          contactId: contact.id,
        },
      },
      update: {},
      create: {
        campaignId: campaign.id,
        contactId: contact.id,
        status: clicked ? 'CLICKED' : opened ? 'OPENED' : 'SENT',
        sentAt: new Date(now - 3 * 3600 * 1000),
        deliveredAt: new Date(now - 3 * 3600 * 1000 + 5000),
        openedAt: opened ? new Date(now - 2 * 3600 * 1000) : null,
        clickedAt: clicked ? new Date(now - 1 * 3600 * 1000) : null,
      },
    });
  }
  console.log('Sends créés/à jour pour le rapport de campagne');

  // Le rapport de campagne (analytics.service.getCampaignReport) compte les lignes de la table
  // Analytic par action (Open/Click/Bounce/Unsubscribe) — indépendant des compteurs dénormalisés
  // du Campaign. On aligne les deux pour que Dashboard/Liste et Rapport affichent les mêmes chiffres.
  await prisma.analytic.deleteMany({ where: { campaignId: campaign.id } });
  const buildAnalytics = (action, count) =>
    Array.from({ length: count }).map((_, i) => ({
      campaignId: campaign.id,
      contactId: createdContacts[i % createdContacts.length].id,
      action,
      createdAt: new Date(now - (i % 6) * 3600 * 1000),
    }));
  await prisma.analytic.createMany({
    data: [
      ...buildAnalytics('Open', 312),
      ...buildAnalytics('Click', 96),
      ...buildAnalytics('Bounce', 12),
      ...buildAnalytics('Unsubscribe', 3),
    ],
  });
  console.log(
    'Analytics (Open/Click/Bounce/Unsubscribe) créées pour le rapport',
  );

  // Heatmap d'engagement par heure (pic réaliste en soirée 18h-21h)
  const hourly = {
    8: 10,
    9: 18,
    12: 22,
    13: 15,
    18: 55,
    19: 68,
    20: 74,
    21: 40,
    22: 20,
  };
  for (const [hour, openCount] of Object.entries(hourly)) {
    await prisma.engagementHeatmap.upsert({
      where: {
        campaignId_hour: { campaignId: campaign.id, hour: Number(hour) },
      },
      update: { openCount, clickCount: Math.round(openCount * 0.28) },
      create: {
        campaignId: campaign.id,
        hour: Number(hour),
        openCount,
        clickCount: Math.round(openCount * 0.28),
      },
    });
  }
  console.log("Heatmap d'engagement créée");

  await prisma.clickHeatmap.deleteMany({ where: { campaignId: campaign.id } });
  await prisma.clickHeatmap.createMany({
    data: [
      { campaignId: campaign.id, zone: 'Lien code promo', clickCount: 58 },
      { campaignId: campaign.id, zone: 'Lien boutique', clickCount: 27 },
      { campaignId: campaign.id, zone: 'Lien désabonnement', clickCount: 11 },
    ],
  });
  console.log('Click heatmap créée');

  // Équipe — quelques membres avec rôles variés + une invitation en attente,
  // pour que la page Équipe ne montre pas un unique admin "jamais connecté".
  const teamMembers = [
    {
      email: 'fatou.editor@novasms.dev',
      role: 'Editor',
      firstName: 'Fatou',
      lastName: 'Diabaté',
      lastLogin: new Date(Date.now() - 2 * 3600 * 1000),
    },
    {
      email: 'ibrahim.analyst@novasms.dev',
      role: 'Analyst',
      firstName: 'Ibrahim',
      lastName: 'Ouattara',
      lastLogin: new Date(Date.now() - 26 * 3600 * 1000),
    },
  ];
  for (const m of teamMembers) {
    const existing = await prisma.user.findUnique({
      where: { email: m.email },
    });
    if (!existing) {
      await prisma.user.create({
        data: {
          accountId: account.id,
          email: m.email,
          passwordHash: hashed,
          role: m.role,
          firstName: m.firstName,
          lastName: m.lastName,
          lastLogin: m.lastLogin,
        },
      });
      console.log('Created team member', m.email);
    } else {
      await prisma.user.update({
        where: { id: existing.id },
        data: { lastLogin: m.lastLogin },
      });
    }
  }
  const pendingInviteEmail = 'kouassi.invite@novasms.dev';
  const existingInvite = await prisma.invitation.findFirst({
    where: { accountId: account.id, email: pendingInviteEmail },
  });
  if (!existingInvite) {
    await prisma.invitation.create({
      data: {
        email: pendingInviteEmail,
        token: require('crypto').randomBytes(24).toString('hex'),
        accountId: account.id,
        expiresAt: new Date(Date.now() + 6 * 24 * 3600 * 1000),
        role: 'Editor',
        status: 'Sent',
      },
    });
    console.log('Created pending invitation', pendingInviteEmail);
  }

  await prisma.user.update({
    where: { id: primaryUser.id },
    data: { lastLogin: new Date(), firstName: 'Boutique', lastName: 'Awa' },
  });

  await prisma.$disconnect();
  console.log('--- Compte démo prêt ---');
  console.log('Email:', adminEmail);
  console.log('Mot de passe:', password);
  console.log('2FA secret (base32):', twoFactorSecret);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
