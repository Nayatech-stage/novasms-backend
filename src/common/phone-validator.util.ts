import { parsePhoneNumber, getExampleNumber } from 'libphonenumber-js';
import type { CountryCode, Examples } from 'libphonenumber-js';
import mobileExamples from 'libphonenumber-js/examples.mobile.json';

export type PhoneValidationResult = {
  isValid: boolean;
  status: 'VALID' | 'INVALID' | 'UNVERIFIED';
  formatted: string | null;
  country: string | null;
  message: string | null;
};

function exampleFor(country: CountryCode): string {
  try {
    const ex = getExampleNumber(country, mobileExamples as unknown as Examples);
    return ex ? ex.formatInternational() : `+${country} XXXXXXXXX`;
  } catch {
    return `+${country} XXXXXXXXX`;
  }
}

function normalizePhoneInput(input: string): string {
  const trimmed = input.trim();
  if (trimmed.startsWith('+')) {
    return '+' + trimmed.slice(1).replace(/[\s\-()./]/g, '');
  }
  return trimmed.replace(/[\s\-()./]/g, '');
}

export function validatePhone(
  phone: string,
  defaultCountry: CountryCode = 'CI',
): PhoneValidationResult {
  if (!phone?.trim()) {
    return {
      isValid: false,
      status: 'UNVERIFIED',
      formatted: null,
      country: null,
      message: null,
    };
  }

  const raw = normalizePhoneInput(phone);

  try {
    const parsed = raw.startsWith('+')
      ? parsePhoneNumber(raw)
      : parsePhoneNumber(raw, defaultCountry);

    if (!parsed?.isValid()) {
      const country: CountryCode = (parsed?.country ??
        defaultCountry) as CountryCode;
      const hint = exampleFor(country);
      return {
        isValid: false,
        status: 'INVALID',
        formatted: null,
        country: null,
        message: `Numéro invalide. Exemple attendu : ${hint}`,
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
    const hint = exampleFor(defaultCountry);
    return {
      isValid: false,
      status: 'INVALID',
      formatted: null,
      country: null,
      message: `Format non reconnu. Exemple attendu : ${hint}`,
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
    return validatePhone(phone, defaultCountry).isValid;
  } catch {
    return false;
  }
}
