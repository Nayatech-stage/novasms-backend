export type SmsSendResult = {
  success: boolean;
  messageId?: string;
  error?: string;
};

export type SmsBatchResult = {
  sent: number;
  failed: number;
};

export type SmsContact = {
  phone: string;
};

/**
 * Contrat unique pour tous les providers SMS.
 * Le service metier ne depend que de cette interface.
 */
export interface SmsProvider {
  send(to: string, message: string): Promise<SmsSendResult>;
  sendBatch(contacts: SmsContact[], message: string): Promise<SmsBatchResult>;
}
