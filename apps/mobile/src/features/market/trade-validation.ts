export type InputValidation = {
  state: 'empty' | 'zero' | 'invalid' | 'pending' | 'valid';
  message?: string;
};

const MAX_PROVIDER_AMOUNT_DIGITS = 80;

export function validateBaseUnitAmount(value: string, decimals?: number): InputValidation {
  if (decimals === undefined) return { state: 'pending', message: 'Stock token metadata is still loading.' };
  const trimmed = value.trim();
  if (!trimmed) return { state: 'empty', message: 'Enter an amount greater than zero.' };
  if (!/^\d+(?:\.\d+)?$/.test(trimmed)) return { state: 'invalid', message: 'Use digits and a single decimal point.' };
  const [whole, fraction = ''] = trimmed.split('.');
  if (fraction.length > decimals) {
    return { state: 'invalid', message: decimals === 0 ? 'This asset uses whole units only.' : `Use at most ${decimals} decimal places.` };
  }
  const baseUnits = `${whole}${fraction.padEnd(decimals, '0')}`.replace(/^0+/, '') || '0';
  if (baseUnits === '0') return { state: 'zero', message: 'Enter an amount greater than zero.' };
  if (baseUnits.length > MAX_PROVIDER_AMOUNT_DIGITS) return { state: 'invalid', message: 'This amount is too large.' };
  return { state: 'valid' };
}

export function validateLimitPrice(value: string): InputValidation {
  const trimmed = value.trim();
  if (!trimmed) return { state: 'empty', message: 'Enter a limit price greater than zero.' };
  if (trimmed.length > MAX_PROVIDER_AMOUNT_DIGITS) return { state: 'invalid', message: 'This limit price is too large.' };
  if (!/^\d+(?:\.\d+)?$/.test(trimmed)) return { state: 'invalid', message: 'Use digits and a single decimal point.' };
  const digits = trimmed.replace('.', '').replace(/^0+/, '') || '0';
  if (digits === '0') return { state: 'zero', message: 'Enter a limit price greater than zero.' };
  return { state: 'valid' };
}

export function decimalToBaseUnits(value: string, decimals: number) {
  const validation = validateBaseUnitAmount(value, decimals);
  if (validation.state !== 'valid') throw new Error(validation.message ?? 'Enter a valid amount.');
  const [whole, fraction = ''] = value.trim().split('.');
  return `${whole}${fraction.padEnd(decimals, '0')}`.replace(/^0+(?=\d)/, '');
}

export function normalizeLimitPrice(value: string) {
  const validation = validateLimitPrice(value);
  if (validation.state !== 'valid') throw new Error(validation.message ?? 'Enter a valid decimal amount.');
  return value.trim();
}
