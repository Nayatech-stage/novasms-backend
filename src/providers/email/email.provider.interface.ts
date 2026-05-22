export type EmailSendResult = {
  success: boolean;
  messageId?: string;
  error?: string;
};

export type EmailBatchResult = {
  sent: number;
  failed: number;
};

export type EmailContact = {
  email: string;
};

/**
 * Contrat unique pour tous les providers email.
 * Le service metier n'a pas besoin de connaitre l'implementation concrete.
 */
export interface EmailProvider {
  send(to: string, subject: string, html: string): Promise<EmailSendResult>;
  sendBatch(
    contacts: EmailContact[],
    subject: string,
    html: string,
  ): Promise<EmailBatchResult>;
}
