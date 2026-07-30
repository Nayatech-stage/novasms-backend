/**
 * Tarifs par défaut en FCFA.
 * Surchargeable via variables d'environnement dans .env :
 *   CREDIT_COST_PER_SMS=12
 *   CREDIT_COST_PER_EMAIL=2
 *   CREDIT_COST_PER_WHATSAPP=35
 */
const DEFAULT_COSTS: Record<string, number> = {
  SMS: 12,
  EMAIL: 2,
  WHATSAPP: 35,
};

const ENV_KEYS: Record<string, string> = {
  SMS: 'CREDIT_COST_PER_SMS',
  EMAIL: 'CREDIT_COST_PER_EMAIL',
  WHATSAPP: 'CREDIT_COST_PER_WHATSAPP',
};

/**
 * Retourne le prix unitaire configuré pour un canal (en FCFA).
 * Priorité : variable d'environnement → valeur par défaut.
 */
export function getUnitPrice(channel: string): number {
  const key = channel.toUpperCase();
  const envKey = ENV_KEYS[key];
  if (envKey && process.env[envKey]) {
    return parseFloat(process.env[envKey]!);
  }
  return DEFAULT_COSTS[key] ?? 0;
}

/**
 * Calcule le nombre de parties d'un SMS selon la norme GSM.
 *
 * Encodage GSM7 (caractères latins standards) :
 *   - 1 partie  → max 160 caractères
 *   - multi     → max 153 caractères par partie
 *
 * Encodage Unicode (émojis, arabe, accents hors GSM7) :
 *   - 1 partie  → max 70 caractères
 *   - multi     → max 67 caractères par partie
 */
export function countSmsParts(text: string): number {
  const GSM7_CHARSET =
    /^[\x00-\x7FÀ-ÅÆÇÈ-ËÌ-ÏÐÑÒ-ÖØÙ-Üßàáâãäåæçèéêëìíîïñòóôõöøùúûüýÿ]*$/;
  const isGsm7 = GSM7_CHARSET.test(text);

  const limitSingle = isGsm7 ? 160 : 70;
  const limitMulti = isGsm7 ? 153 : 67;
  const len = text.length;

  if (len === 0) return 1;
  if (len <= limitSingle) return 1;
  return Math.ceil(len / limitMulti);
}

/**
 * Calcule le coût total d'un envoi.
 *
 * SMS   : parties × nbContacts × prixUnitaire
 * Email : nbContacts × prixUnitaire
 * WA    : nbContacts × prixUnitaire
 *
 * @param channel      'SMS' | 'Email' | 'WhatsApp'
 * @param nbContacts   Nombre de destinataires
 * @param text         Contenu du message (utilisé uniquement pour SMS)
 * @returns            { parts, unitPrice, total } en FCFA
 */
export function calculateSendCost(
  channel: string,
  nbContacts: number,
  text = '',
): { parts: number; unitPrice: number; total: number } {
  const unitPrice = getUnitPrice(channel);
  const parts = channel.toUpperCase() === 'SMS' ? countSmsParts(text) : 1;
  const total = parts * nbContacts * unitPrice;
  return { parts, unitPrice, total };
}
