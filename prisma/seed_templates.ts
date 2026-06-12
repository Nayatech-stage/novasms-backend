import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const TEMPLATES = [
  {
    key: 'welcome-email',
    name: 'Email de bienvenue',
    channelType: 'EMAIL',
    contentText:
      'Bonjour {{prenom}}, bienvenue chez {{boutique}} ! Votre compte est actif.',
    htmlContent:
      '<h1>Bienvenue {{prenom}} !</h1><p>Merci de rejoindre <strong>{{boutique}}</strong>. Votre compte est désormais actif.</p>',
  },
  {
    key: 'promo-flash',
    name: 'Promo flash',
    channelType: 'EMAIL',
    contentText:
      'Bonjour {{prenom}}, profitez de -20 % avec le code {{code_promo}}. Valable 48h.',
    htmlContent:
      '<h2>Offre flash !</h2><p>Bonjour {{prenom}},</p><p>Profitez de <strong>-20 %</strong> avec le code <strong>{{code_promo}}</strong>. Valable 48h seulement.</p>',
  },
  {
    key: 'abandon-panier',
    name: 'Panier abandonné',
    channelType: 'EMAIL',
    contentText:
      'Bonjour {{prenom}}, vous avez laissé des articles dans votre panier. Finalisez votre commande.',
    htmlContent:
      '<h2>Votre panier vous attend !</h2><p>Bonjour {{prenom}},</p><p>Vous avez laissé des articles dans votre panier. <a href="#">Finaliser ma commande</a></p>',
  },
  {
    key: 'confirmation-commande',
    name: 'Confirmation de commande',
    channelType: 'EMAIL',
    contentText:
      'Bonjour {{prenom}}, votre commande a bien été enregistrée. Merci de votre confiance.',
    htmlContent:
      '<h2>Commande confirmée</h2><p>Bonjour {{prenom}},</p><p>Votre commande a bien été enregistrée. Merci de votre confiance chez {{boutique}} !</p>',
  },
  {
    key: 'newsletter-mensuelle',
    name: 'Newsletter mensuelle',
    channelType: 'EMAIL',
    contentText:
      'Bonjour {{prenom}}, voici les actualités du mois chez {{boutique}}.',
    htmlContent:
      '<h2>Actualités du mois</h2><p>Bonjour {{prenom}},</p><p>Découvrez les dernières nouveautés de <strong>{{boutique}}</strong> ce mois-ci.</p>',
  },
  {
    key: 'anniversaire',
    name: 'Email anniversaire',
    channelType: 'EMAIL',
    contentText:
      "Bonjour {{prenom}}, toute l'équipe {{boutique}} vous souhaite un joyeux anniversaire ! Code cadeau : {{code_promo}}.",
    htmlContent:
      "<h2>Joyeux anniversaire {{prenom}} !</h2><p>Toute l'équipe de <strong>{{boutique}}</strong> vous adresse ses vœux. Votre cadeau : <strong>{{code_promo}}</strong></p>",
  },
  {
    key: 'reactivation',
    name: 'Réactivation client inactif',
    channelType: 'EMAIL',
    contentText:
      'Bonjour {{prenom}}, cela fait un moment. Voici une offre exclusive pour votre retour.',
    htmlContent:
      '<h2>Vous nous manquez</h2><p>Bonjour {{prenom}},</p><p>Cela fait un moment. Voici une offre exclusive pour célébrer votre retour : <strong>{{code_promo}}</strong></p>',
  },
  {
    key: 'enquete-satisfaction',
    name: 'Enquête de satisfaction',
    channelType: 'EMAIL',
    contentText:
      'Bonjour {{prenom}}, partagez votre avis sur votre expérience chez {{boutique}}. Cela prend 2 minutes.',
    htmlContent:
      '<h2>Votre avis nous intéresse</h2><p>Bonjour {{prenom}},</p><p>Partagez votre expérience chez <strong>{{boutique}}</strong> en 2 minutes.</p><p><a href="#">Répondre au sondage</a></p>',
  },
  {
    key: 'invitation-evenement',
    name: 'Invitation événement',
    channelType: 'EMAIL',
    contentText:
      'Bonjour {{prenom}}, nous avons le plaisir de vous inviter à notre prochain événement.',
    htmlContent:
      '<h2>Vous êtes invité(e)</h2><p>Bonjour {{prenom}},</p><p>Nous avons le plaisir de vous convier à notre prochain événement organisé par <strong>{{boutique}}</strong>.</p>',
  },
  {
    key: 'offre-vip',
    name: 'Offre VIP client fidèle',
    channelType: 'EMAIL',
    contentText:
      "Bonjour {{prenom}}, en tant que client fidèle vous bénéficiez d'une offre exclusive : {{code_promo}}.",
    htmlContent:
      '<h2>Offre VIP</h2><p>Bonjour {{prenom}},</p><p>En tant que client fidèle de <strong>{{boutique}}</strong>, profitez de votre avantage exclusif : <strong>{{code_promo}}</strong></p>',
  },
  {
    key: 'relance-devis',
    name: 'Relance devis',
    channelType: 'EMAIL',
    contentText:
      'Bonjour {{prenom}}, votre devis chez {{boutique}} est toujours disponible. Souhaitez-vous finaliser ?',
    htmlContent:
      '<h2>Votre devis vous attend</h2><p>Bonjour {{prenom}},</p><p>Votre devis chez <strong>{{boutique}}</strong> est toujours valable. <a href="#">Consulter le devis</a></p>',
  },
  {
    key: 'notification-livraison',
    name: 'Notification de livraison',
    channelType: 'EMAIL',
    contentText:
      'Bonjour {{prenom}}, votre commande est en cours de livraison. Suivez-la ici.',
    htmlContent:
      '<h2>En cours de livraison</h2><p>Bonjour {{prenom}},</p><p>Votre commande est en route ! <a href="{{lien}}">Suivre mon colis</a></p>',
  },
  {
    key: 'alerte-stock',
    name: 'Alerte retour en stock',
    channelType: 'EMAIL',
    contentText:
      'Bonjour {{prenom}}, le produit {{produit}} est de retour en stock. Commandez vite !',
    htmlContent:
      '<h2>De retour en stock !</h2><p>Bonjour {{prenom}},</p><p><strong>{{produit}}</strong> est à nouveau disponible chez {{boutique}}. <a href="#">Commander maintenant</a></p>',
  },
  {
    key: 'parrainage',
    name: 'Programme de parrainage',
    channelType: 'EMAIL',
    contentText:
      'Bonjour {{prenom}}, parrainez un ami et recevez {{code_promo}} chacun.',
    htmlContent:
      '<h2>Parrainez et gagnez</h2><p>Bonjour {{prenom}},</p><p>Invitez un ami chez <strong>{{boutique}}</strong> et recevez chacun une récompense : <strong>{{code_promo}}</strong></p>',
  },
  {
    key: 'sms-bienvenue',
    name: 'SMS bienvenue',
    channelType: 'SMS',
    contentText:
      'Bienvenue {{prenom}} chez {{boutique}} ! Code exclusif : {{code_promo}}. STOP pour se désabonner.',
    htmlContent: null,
  },
  {
    key: 'sms-promo',
    name: 'SMS promo flash',
    channelType: 'SMS',
    contentText:
      "{{boutique}} : Offre flash 24h ! -15% avec {{code_promo}}. Valable aujourd'hui. STOP pour arrêter.",
    htmlContent: null,
  },
  {
    key: 'sms-confirmation',
    name: 'SMS confirmation commande',
    channelType: 'SMS',
    contentText:
      '{{boutique}} : Commande confirmée ! Merci {{prenom}}. Suivi : {{lien}}. STOP pour désabonnement.',
    htmlContent: null,
  },
  {
    key: 'sms-rappel',
    name: 'SMS rappel rendez-vous',
    channelType: 'SMS',
    contentText:
      'Rappel {{boutique}} : RDV le {{date}} à {{heure}}. Modifier : {{lien}}. STOP pour arrêter.',
    htmlContent: null,
  },
  {
    key: 'sms-anniversaire',
    name: 'SMS anniversaire',
    channelType: 'SMS',
    contentText:
      '{{boutique}} : Joyeux anniversaire {{prenom}} ! Cadeau : {{code_promo}}. Valable 7j. STOP pour désabonner.',
    htmlContent: null,
  },
  {
    key: 'sms-reactivation',
    name: 'SMS réactivation',
    channelType: 'SMS',
    contentText:
      '{{boutique}} : {{prenom}}, vous nous manquez ! Offre exclusive : {{code_promo}}. STOP pour arrêter.',
    htmlContent: null,
  },
];

async function main() {
  const account = await prisma.account.findFirst({ select: { id: true } });
  if (!account) {
    throw new Error(
      'Aucun compte trouvé. Créez un compte avant de lancer le seed.',
    );
  }

  let created = 0;
  let updated = 0;

  for (const tpl of TEMPLATES) {
    const result = await prisma.template.upsert({
      where: { key: tpl.key },
      update: {
        name: tpl.name,
        channelType: tpl.channelType,
        contentText: tpl.contentText,
        htmlContent: tpl.htmlContent ?? null,
        isPreset: true,
      },
      create: {
        accountId: account.id,
        key: tpl.key,
        name: tpl.name,
        channelType: tpl.channelType,
        contentText: tpl.contentText,
        htmlContent: tpl.htmlContent ?? null,
        isPreset: true,
      },
    });
    if (result.createdAt.getTime() === result.updatedAt.getTime()) {
      created++;
    } else {
      updated++;
    }
  }

  console.log(`Templates: ${created} créés, ${updated} mis à jour.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
