export function lendingAmountToRaw(value: string, decimals: number, scaledUiMultiplier = '1'): string {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d*)?$/.test(normalized)) throw new Error('Enter a positive amount using digits and a decimal point.');
  const [whole, fraction = ''] = normalized.split('.');
  if (!/^\d+(?:\.\d+)?$/.test(scaledUiMultiplier)) throw new Error('This token has an invalid scaled UI multiplier.');
  const [multiplierWhole, multiplierFraction = ''] = scaledUiMultiplier.split('.');
  if (fraction.length > decimals + multiplierFraction.length) throw new Error(`This token amount exceeds its base-unit precision.`);
  const valueNumerator = BigInt(`${whole}${fraction}` || '0');
  const multiplierNumerator = BigInt(`${multiplierWhole}${multiplierFraction}`);
  if (multiplierNumerator <= 0n) throw new Error('This token has an invalid scaled UI multiplier.');
  const numerator = valueNumerator * 10n ** BigInt(decimals) * 10n ** BigInt(multiplierFraction.length);
  const denominator = 10n ** BigInt(fraction.length) * multiplierNumerator;
  const raw = numerator / denominator;
  if (raw <= 0n) throw new Error('Enter an amount greater than zero.');
  return raw.toString();
}

export function cleanLendingAmountInput(value: string) {
  return value.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1');
}
