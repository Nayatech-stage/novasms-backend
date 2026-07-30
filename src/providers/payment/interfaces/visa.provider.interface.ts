export type VisaPaymentParams = {
  amount: number;
  currency?: string;
  description?: string;
  paymentMethodId?: string;
};

export type VisaPaymentResult = {
  success: boolean;
  transactionId?: string;
  status?: string;
  error?: string;
  requiresAction?: boolean;
  clientSecret?: string;
};

export interface VisaProvider {
  charge(params: VisaPaymentParams): Promise<VisaPaymentResult>;
  getPaymentIntent(id: string): Promise<{ id: string; status: string } | null>;
  isConfigured(): boolean;
}
