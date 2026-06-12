import { WhatsappProvider } from './whatsapp.provider.interface';

export class TwilioWhatsappProvider implements WhatsappProvider {
  private accountSid = process.env.TWILIO_ACCOUNT_SID || '';
  private authToken = process.env.TWILIO_AUTH_TOKEN || '';
  private fromNumber = process.env.TWILIO_WHATSAPP_NUMBER || '';

  async send(to: string, message: string) {
    if (!this.accountSid || !this.authToken || !this.fromNumber) {
      return { success: false, error: 'Twilio credentials missing' };
    }

    try {
      const url = `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`;
      const form = new URLSearchParams();
      form.append('From', `whatsapp:${this.fromNumber}`);
      form.append('To', `whatsapp:${to}`);
      form.append('Body', message);

      const res = await fetch(url, {
        method: 'POST',
        body: form,
        headers: {
          Authorization:
            'Basic ' +
            Buffer.from(`${this.accountSid}:${this.authToken}`).toString(
              'base64',
            ),
        },
      });
      if (!res.ok) {
        const txt = await res.text();
        return { success: false, error: `Twilio error ${res.status}: ${txt}` };
      }
      const json = await res.json();
      return { success: true, messageId: json.sid };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
