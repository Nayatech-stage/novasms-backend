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

export type MobileMoneyPaymentResult = {
  success: boolean;
  transactionId?: string;
  reference?: string; // référence NovaSend pour le suivi de statut
  status: 'pending' | 'completed' | 'failed';
  paymentUrl?: string; // Wave : URL de confirmation client
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
}
