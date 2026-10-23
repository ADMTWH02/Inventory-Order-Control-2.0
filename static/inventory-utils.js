const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const monthIndexes = new Map([
  ['JAN', 1], ['FEB', 2], ['MAR', 3], ['APR', 4], ['MAY', 5], ['MEI', 5],
  ['JUN', 6], ['JUL', 7], ['AUG', 8], ['AGU', 8], ['SEP', 9],
  ['OCT', 10], ['OKT', 10], ['NOV', 11], ['DEC', 12], ['DES', 12],
]);

export function parseNumeric(value) {
  let cleaned = String(value ?? '').replace(/[^\d,.-]/g, '');
  if (!cleaned || !/\d/.test(cleaned)) return null;
  const comma = cleaned.lastIndexOf(',');
  const dot = cleaned.lastIndexOf('.');
  if (comma >= 0 && dot >= 0) {
    cleaned = comma > dot
      ? cleaned.replace(/\./g, '').replace(',', '.')
      : cleaned.replace(/,/g, '');
  } else if (comma >= 0) {
    cleaned = cleaned.replace(/\./g, '').replace(',', '.');
  } else if ((cleaned.match(/\./g) || []).length > 1
    || (dot >= 0 && cleaned.length - dot - 1 === 3 && Number(cleaned.slice(0, dot)) !== 0)) {
    cleaned = cleaned.replace(/\./g, '');
  }
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : null;
}

export function getAutomaticStatus(stock, rop) {
  const stockValue = parseNumeric(stock);
  const ropValue = parseNumeric(rop);
  if (stockValue === null || ropValue === null) return '';
  return stockValue < ropValue ? 'PESAN' : 'TIDAK';
}

export function monthKey(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export function latestMonthKeys(count = 6, now = new Date()) {
  const current = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return Array.from({ length: count }, (_, offset) => {
    const date = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() - count + offset + 1, 1));
    return monthKey(date);
  });
}

export function monthRange(startMonth, endMonth) {
  const [startYear, startNumber] = startMonth.split('-').map(Number);
  const [endYear, endNumber] = endMonth.split('-').map(Number);
  const current = new Date(Date.UTC(startYear, startNumber - 1, 1));
  const end = new Date(Date.UTC(endYear, endNumber - 1, 1));
  const months = [];
  while (current <= end) {
    months.push(monthKey(current));
    current.setUTCMonth(current.getUTCMonth() + 1);
  }
  return months;
}

export function formatMonthLabel(key) {
  const [year, month] = key.split('-').map(Number);
  return `${monthNames[month - 1]} ${String(year).slice(-2)}`;
}

export function parseMonthHeader(header) {
  const value = String(header).trim().toUpperCase();
  const isoMatch = value.match(/^(\d{4})-(0[1-9]|1[0-2])$/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}`;

  const monthMatch = value.match(/^([A-Z]{3,})[\s/_-]+(\d{2}|\d{4})$/);
  if (!monthMatch) return null;
  const month = monthIndexes.get(monthMatch[1].slice(0, 3));
  if (!month) return null;
  const rawYear = Number(monthMatch[2]);
  const year = rawYear < 100 ? 2000 + rawYear : rawYear;
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function calculateRollingStats(usage, months = latestMonthKeys()) {
  const values = months
    .map((month) => usage[month])
    .filter((value) => value !== null && value !== undefined && String(value).trim() !== '')
    .map((value) => Number(value))
    .filter(Number.isFinite);
  if (!values.length) return { average: null, standardDeviation: null };

  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  const squaredDifferences = values.reduce((sum, value) => sum + (value - average) ** 2, 0);
  const standardDeviation = values.length > 1
    ? Math.sqrt(squaredDifferences / (values.length - 1))
    : null;
  return { average, standardDeviation };
}
