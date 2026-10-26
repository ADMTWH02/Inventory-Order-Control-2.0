import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateRollingStats,
  formatRoundedNumber,
  getAutomaticStatus,
  getProcurementSummary,
  latestMonthKeys,
  monthRange,
  parseMonthHeader,
  parseNumeric,
} from '../static/inventory-utils.js';

test('rolling window contains the current month and five preceding calendar months', () => {
  assert.deepEqual(
    latestMonthKeys(6, new Date('2026-10-23T12:00:00.000Z')),
    ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'],
  );
});

test('month range rolls through year boundaries', () => {
  assert.deepEqual(monthRange('2025-11', '2026-02'), ['2025-11', '2025-12', '2026-01', '2026-02']);
});

test('rolling average includes zero and ignores empty months', () => {
  const stats = calculateRollingStats({
    '2026-05': 0,
    '2026-06': 10,
    '2026-07': '',
    '2026-08': 20,
    '2026-09': null,
    '2026-10': undefined,
  }, ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);

  assert.equal(stats.average, 10);
  assert.equal(stats.standardDeviation, 10);
});

test('single usage value has an average and no sample standard deviation', () => {
  assert.deepEqual(
    calculateRollingStats({ '2026-10': 8 }, ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']),
    { average: 8, standardDeviation: null },
  );
});

test('month headers recognize legacy and current Excel labels', () => {
  assert.equal(parseMonthHeader('Jan 26'), '2026-01');
  assert.equal(parseMonthHeader('JAN_2026'), '2026-01');
  assert.equal(parseMonthHeader('Mei-2026'), '2026-05');
  assert.equal(parseMonthHeader('2026-10'), '2026-10');
  assert.equal(parseMonthHeader('Stock 20.10.2026 (update)'), null);
});

test('numeric parsing handles Indonesian decimal and grouping separators', () => {
  assert.equal(parseNumeric('1.234,5'), 1234.5);
  assert.equal(parseNumeric('0.125'), 0.125);
  assert.equal(parseNumeric('-2,5'), -2.5);
  assert.equal(parseNumeric('not a number'), null);
});

test('numeric display rounds to whole numbers with Indonesian grouping', () => {
  assert.equal(formatRoundedNumber('2808.98114387803'), '2.809');
  assert.equal(formatRoundedNumber('0.4'), '0');
  assert.equal(formatRoundedNumber('1.234,5'), '1.235');
  assert.equal(formatRoundedNumber(''), '');
  assert.equal(formatRoundedNumber('—'), '—');
});

test('automatic status orders below ROP and remains safe at or above ROP', () => {
  assert.equal(getAutomaticStatus('1.000', '1.200'), 'PESAN');
  assert.equal(getAutomaticStatus('1.200', '1.200'), 'TIDAK');
  assert.equal(getAutomaticStatus('1300', '1.200'), 'TIDAK');
  assert.equal(getAutomaticStatus('', '1.200'), '');
});

test('procurement summary counts populated PR and PO and groups uncommitted order value', () => {
  const summary = getProcurementSummary([
    {
      status: 'PESAN',
      purchase_requisition: '',
      purchase_order: '',
      price: '1.000',
      rop_minstock: '2',
      part_category: 'Electrical',
      sub_category: 'Cable',
    },
    {
      status: 'PESAN',
      purchase_requisition: '',
      purchase_order: '',
      price: '500',
      rop_minstock: '3',
      part_category: 'Electrical',
      sub_category: 'Cable',
    },
    {
      status: 'PESAN',
      purchase_requisition: 'PR-1',
      purchase_order: '',
      price: '900',
      rop_minstock: '1',
      part_category: 'Mechanical',
      sub_category: 'Valve',
    },
    {
      status: 'TIDAK',
      purchase_requisition: '',
      purchase_order: 'PO-2',
      price: '700',
      rop_minstock: '1',
      part_category: 'Mechanical',
      sub_category: 'Valve',
    },
    {
      status: 'PESAN',
      purchase_requisition: '',
      purchase_order: '',
      price: '',
      rop_minstock: '1',
      part_category: 'Mechanical',
      sub_category: 'Valve',
    },
  ]);

  assert.equal(summary.withPurchaseRequest, 1);
  assert.equal(summary.withPurchaseOrder, 1);
  assert.equal(summary.missingValueCount, 1);
  assert.deepEqual(summary.orderValueByCategory, [{
    category: 'Electrical',
    itemCount: 2,
    value: 3500,
  }]);
});

test('procurement chart groups by part category and expands operational abbreviation', () => {
  const summary = getProcurementSummary([
    {
      status: 'PESAN',
      price: '100',
      rop_minstock: '1',
      part_category: 'Con.Operational',
      sub_category: 'Chemical',
    },
    {
      status: 'PESAN',
      price: '200',
      rop_minstock: '1',
      part_category: 'Consumable Operational',
      sub_category: 'Lubricant',
    },
    {
      status: 'PESAN',
      price: '300',
      rop_minstock: '1',
      part_category: 'Consumable Part',
      sub_category: 'Part',
    },
  ]);

  assert.deepEqual(summary.orderValueByCategory, [
    { category: 'Consumable Operational', itemCount: 2, value: 300 },
    { category: 'Consumable Part', itemCount: 1, value: 300 },
  ]);
});
