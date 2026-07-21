export type MobileMoneyOperator = 'WAVE' | 'ORANGE' | 'MOMO' | 'MOOV';

export type MobileMoneyPaymentParams = {
  operator: MobileMoneyOperator;
  phoneNumber: string; // format international ex: +225XXXXXXXXX
  amount: number;
  currency: string;
  description?: string;
  accountId: string;
  userId: string;
  otp?: string; // obligatoire pour ORANGE (via #144*82#)
  country?: string; // ISO 3166-1 alpha-2 : CI | CM (défaut CI)
  customerName?: string;
};

/**
 * Paramètres pour une session de paiement NovaSend (/v1/payin/sessions).
 * Pas d'operator ni d'OTP : NovaSend détecte l'opérateur depuis le numéro
 * et gère la confirmation via son propre UI (paymentUrl).
 */
export type PaymentSessionParams = {
  phoneNumber: string;
  amount: number;
  customerName?: string;
  country?: string;
  accountId: string;
  userId: string;
  userEmail?: string;
  currency?: string;
};

export type MobileMoneyPaymentResult = {
  success: boolean;
  transactionId?: string;
  reference?: string; // référence NovaSend pour le suivi de statut
  status: 'pending' | 'completed' | 'failed';
  paymentUrl?: string; // URL de confirmation client (Wave / Session)
  error?: string;
};

export interface MobileMoneyProvider {
  initiatePayment(
    params: MobileMoneyPaymentParams,
  ): Promise<MobileMoneyPaymentResult>;
  confirmPayment(
    transactionId: string,
    otp: string,
  ): Promise<MobileMoneyPaymentResult>;
  getStatus(reference: string): Promise<MobileMoneyPaymentResult>;
  createSession(
    params: PaymentSessionParams,
  ): Promise<MobileMoneyPaymentResult>;
}
