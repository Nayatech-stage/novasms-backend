import { parsePhoneNumber, isValidPhoneNumber } from 'libphonenumber-js';
import type { CountryCode } from 'libphonenumber-js';

export type PhoneValidationResult = {
  isValid: boolean;
  status: 'VALID' | 'INVALID' | 'UNVERIFIED';
  formatted: string | null;
  country: string | null;
  message: string | null;
};

const COUNTRY_HINTS: Record<string, string> = {
  CI: '+225 07/05/01 XX XX XX XX',
  SN: '+221 7X XXX XX XX',
  ML: '+223 XX XX XX XX',
  BF: '+226 XX XX XX XX',
  BJ: '+229 XX XX XX XX',
  TG: '+228 XX XX XX XX',
  CM: '+237 6X XX XX XX XX',
  GH: '+233 XX XXX XXXX',
  NG: '+234 XXX XXX XXXX',
  FR: '+33 6/7 XX XX XX XX',
};

export function validatePhone(
  phone: string,
  defaultCountry: CountryCode = 'CI',
): PhoneValidationResult {
  if (!phone || !phone.trim()) {
    return {
      isValid: false,
      status: 'UNVERIFIED',
      formatted: null,
      country: null,
      message: null,
    };
  }

  const raw = phone.trim();

  try {
    const parsed = parsePhoneNumber(raw, defaultCountry);

    if (!parsed || !parsed.isValid()) {
      const hint =
        COUNTRY_HINTS[defaultCountry] ?? `+${defaultCountry}XXXXXXXXX`;
      return {
        isValid: false,
        status: 'INVALID',
        formatted: null,
        country: null,
        message: `Numéro invalide. Format attendu : ${hint}`,
      };
    }

    return {
      isValid: true,
      status: 'VALID',
      formatted: parsed.format('E.164'),
      country: parsed.country ?? null,
      message: null,
    };
  } catch {
    return {
      isValid: false,
      status: 'INVALID',
      formatted: null,
      country: null,
      message:
        "Format de numéro non reconnu. Incluez l'indicatif pays (ex: +225…)",
    };
  }
}

export function validatePhoneOrNull(
  phone: string | null | undefined,
  defaultCountry: CountryCode = 'CI',
): PhoneValidationResult {
  if (!phone) {
    return {
      isValid: false,
      status: 'UNVERIFIED',
      formatted: null,
      country: null,
      message: null,
    };
  }
  return validatePhone(phone, defaultCountry);
}

export function isValidPhone(
  phone: string,
  defaultCountry: CountryCode = 'CI',
): boolean {
  try {
    return isValidPhoneNumber(phone, defaultCountry);
  } catch {
    return false;
  }
}
