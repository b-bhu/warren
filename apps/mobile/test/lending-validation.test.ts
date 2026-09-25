import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanLendingAmountInput, lendingAmountToRaw } from '../src/features/market/lending-validation.js';

test('lending amount input converts exactly to token base units without floating point', () => {
  assert.equal(lendingAmountToRaw('12.340001', 6), '12340001');
  assert.equal(lendingAmountToRaw('0.00000001', 8), '1');
  assert.equal(lendingAmountToRaw('01.2', 6), '1200000');
  assert.equal(lendingAmountToRaw('2', 8, '10'), '20000000');
  assert.equal(lendingAmountToRaw('0.1', 8, '10'), '1000000');
});

test('lending amount input rejects zero, exponent notation, negatives, and excess precision', () => {
  for (const value of ['0', '1e6', '-1', '.5']) assert.throws(() => lendingAmountToRaw(value, 6));
  assert.throws(() => lendingAmountToRaw('0.0000001', 6), /precision/);
});

test('lending amount keyboard input strips unsupported characters and duplicate decimal points', () => {
  assert.equal(cleanLendingAmountInput('1.2.3x'), '1.23');
});
