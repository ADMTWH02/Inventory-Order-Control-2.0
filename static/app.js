import { createClient } from '@supabase/supabase-js';
import {
  formatMonthLabel,
  formatRoundedNumber,
  getAutomaticStatus,
  getProcurementSummary,
  latestMonthKeys,
  monthKey,
  monthRange,
  parseMonthHeader,
  parseNumeric,
} from './inventory-utils.js';

const fields = [
  { key: 'ppm', label: 'PPM', section: 'Identitas material', required: true },
  { key: 'material_description', label: 'Material description', section: 'Identitas material' },
  { key: 'part_category', label: 'Part category', section: 'Identitas material' },
  { key: 'sub_category', label: 'Sub-category', section: 'Identitas material' },
  { key: 'average_monthly_update', label: 'Average/M · 6 bulan', section: 'Parameter perencanaan', readonly: true },
  { key: 'average', label: 'Average', section: 'Parameter perencanaan' },
  { key: 'average_daily', label: 'Average/D', section: 'Parameter perencanaan' },
  { key: 'lead_time_full', label: 'Lead time full', section: 'Parameter perencanaan' },
  { key: 'cycle_stock', label: 'Cycle stock', section: 'Parameter perencanaan' },
  { key: 'service_factor', label: 'Service factor', section: 'Parameter perencanaan' },
  { key: 'lead_time_factor', label: 'Lead time factor', section: 'Parameter perencanaan' },
  { key: 'standard_deviation_update', label: 'Standard dev. · 6 bulan', section: 'Parameter perencanaan', readonly: true },
  { key: 'safety_stock', label: 'Safety stock', section: 'Parameter perencanaan' },
  { key: 'lead_time', label: 'Lead time', section: 'Parameter perencanaan' },
  { key: 'max_stock', label: 'Max. stock', section: 'Parameter perencanaan' },
  { key: 'status', label: 'Status', section: 'Kontrol stok', type: 'status', readonly: true },
  { key: 'price', label: 'Price', section: 'Kontrol stok' },
  { key: 'max_value', label: 'Max. value', section: 'Kontrol stok' },
  { key: 'stock_2026_10_20_update', label: 'Stock quantity (update)', section: 'Kontrol stok' },
  { key: 'rop_minstock', label: 'ROP (minstock)', section: 'Kontrol stok' },
  { key: 'roq_order', label: 'ROQ (order)', section: 'Kontrol stok' },
  { key: 'qty_order', label: 'Qty order', section: 'Kontrol stok' },
  { key: 'purchase_requisition', label: 'Purchase requisition', section: 'Pembelian & durasi' },
  { key: 'purchase_order', label: 'Purchase order', section: 'Pembelian & durasi' },
  { key: 'durasi_stock_bulan', label: 'Durasi stock (bulan)', section: 'Pembelian & durasi' },
  { key: 'durasi_roq_bulan', label: 'Durasi ROQ (bulan)', section: 'Pembelian & durasi' },
  { key: 'minimum_order_quantity', label: 'Minimum order quantity', section: 'Pembelian & durasi' },
];

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;
const headerMap = new Map(fields.flatMap((field) => [
  [field.key.toUpperCase(), field.key],
  [field.label.toUpperCase(), field.key],
]));
headerMap.set('STOCK 20.10.2026 (UPDATE)', 'stock_2026_10_20_update');
const state = {
  items: [],
  user: null,
  editingId: null,
  setupRequired: false,
  toastTimer: null,
  confirmAction: null,
  previousFocus: null,
};
const byId = (id) => document.getElementById(id);
let initializePromise = null;
let excelLibraryPromise = null;

function showToast(message, isError = false) {
  const toast = byId('toast');
  toast.textContent = message;
  toast.classList.toggle('error', isError);
  toast.classList.add('visible');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toast.classList.remove('visible'), 3500);
}

function monthValueCell(item, month) {
  const td = document.createElement('td');
  const value = item.monthly_usage?.[month];
  td.textContent = value === undefined || value === '' ? '—' : formatRoundedNumber(value);
  return td;
}

function throwIfError(error) {
  if (error) throw new Error(error.message || 'Terjadi kesalahan saat mengakses Supabase.');
}

function setAuthMode(setupRequired) {
  state.setupRequired = setupRequired;
  byId('auth-layer').hidden = false;
  byId('auth-error').hidden = true;
  byId('auth-eyebrow').textContent = setupRequired ? 'PENYIAPAN ADMIN' : 'AKSES TERBATAS';
  byId('auth-title').textContent = setupRequired ? 'Akun HOST belum disiapkan' : 'Selamat datang';
  byId('auth-description').textContent = setupRequired
    ? 'Buat akun melalui Supabase Dashboard dan tetapkan role HOST sebelum masuk.'
    : 'Masuk menggunakan email akun HOST untuk mengelola inventori.';
  byId('auth-submit').textContent = 'Masuk sebagai HOST';
  byId('auth-submit').hidden = setupRequired;
  byId('auth-username').disabled = setupRequired;
  byId('auth-password').disabled = setupRequired;
  byId('auth-setup').hidden = !setupRequired;
  byId('auth-password').value = '';
  byId('auth-password').autocomplete = 'current-password';
  byId('auth-password').minLength = 1;
  byId('password-hint').hidden = !setupRequired;
  byId('auth-footnote').textContent = setupRequired
    ? 'Pendaftaran publik dinonaktifkan agar role HOST tidak dapat diambil pihak lain.'
    : 'Akun HOST memiliki izin untuk mengelola seluruh data.';
}

function renderTableHead() {
  const row = document.createElement('tr');
  const identityFields = fields.slice(0, 4);
  const remainingFields = fields.slice(4);
  for (const field of identityFields) {
    const th = document.createElement('th');
    th.textContent = field.label;
    row.append(th);
  }
  for (const month of displayedHistoryMonths()) {
    const th = document.createElement('th');
    th.textContent = formatMonthLabel(month);
    th.title = `Pemakaian ${formatMonthLabel(month)}`;
    row.append(th);
  }
  for (const field of remainingFields) {
    const th = document.createElement('th');
    th.textContent = field.label;
    row.append(th);
  }
  const actions = document.createElement('th');
  actions.textContent = 'AKSI';
  row.append(actions);
  byId('table-head').replaceChildren(row);
}

function displayedHistoryMonths() {
  const recordedMonths = state.items.flatMap((item) => Object.keys(item.monthly_usage || {})).sort();
  if (!recordedMonths.length) return latestMonthKeys();
  const latest = recordedMonths[recordedMonths.length - 1];
  const [year, month] = latest.split('-').map(Number);
  const start = new Date(Date.UTC(year, month - 1 - 5, 1));
  return monthRange(monthKey(start), latest);
}

function valueCell(item, field) {
  const td = document.createElement('td');
  const value = item[field.key] || '—';
  if (field.key === 'status') {
    const badge = document.createElement('span');
    const isOrder = value.toUpperCase() === 'PESAN';
    badge.className = `status-pill ${isOrder ? 'status-order' : 'status-safe'}`;
    badge.textContent = value === '—' ? 'KOSONG' : value.toUpperCase();
    td.append(badge);
  } else {
    td.textContent = [
      'ppm',
      'material_description',
      'part_category',
      'sub_category',
      'purchase_requisition',
      'purchase_order',
    ].includes(field.key)
      ? value
      : field.key === 'price'
        ? `Rp ${formatRoundedNumber(item[field.key])}`
        : formatRoundedNumber(item[field.key]);
    if (field.key === 'material_description') td.classList.add('material-cell');
    if (['part_category', 'sub_category'].includes(field.key)) td.classList.add('category-cell');
  }
  return td;
}

function visibleItems() {
  const search = byId('search-input').value.trim().toLocaleLowerCase('id');
  const status = byId('status-filter').value;
  return state.items.filter((item) => {
    if (status && (item.status || '').toUpperCase() !== status) return false;
    return !search || fields.some((field) =>
      (item[field.key] || '').toLocaleLowerCase('id').includes(search))
      || Object.entries(item.monthly_usage || {}).some(([month, value]) =>
        `${formatMonthLabel(month)} ${value}`.toLocaleLowerCase('id').includes(search));
  });
}

function renderItems() {
  renderTableHead();
  const list = visibleItems();
  const body = byId('table-body');
  const rows = list.map((item) => {
    const row = document.createElement('tr');
    for (const field of fields.slice(0, 4)) row.append(valueCell(item, field));
    for (const month of displayedHistoryMonths()) row.append(monthValueCell(item, month));
    for (const field of fields.slice(4)) row.append(valueCell(item, field));
    const actionCell = document.createElement('td');
    const actions = document.createElement('div');
    actions.className = 'row-actions';
    const edit = document.createElement('button');
    edit.className = 'row-action';
    edit.type = 'button';
    edit.title = 'Edit material';
    edit.setAttribute('aria-label', `Edit ${item.ppm}`);
    edit.textContent = '✎';
    edit.addEventListener('click', () => openItemModal(item));
    const remove = document.createElement('button');
    remove.className = 'row-action delete';
    remove.type = 'button';
    remove.title = 'Hapus material';
    remove.setAttribute('aria-label', `Hapus ${item.ppm}`);
    remove.textContent = '×';
    remove.addEventListener('click', () => deleteItem(item));
    actions.append(edit, remove);
    actionCell.append(actions);
    row.append(actionCell);
    return row;
  });
  body.replaceChildren(...rows);
  byId('table-wrap').hidden = list.length === 0;
  byId('empty-state').hidden = list.length !== 0;
  byId('results-count').textContent = list.length === state.items.length
    ? `${state.items.length} material`
    : `${list.length} dari ${state.items.length} material`;
  renderMetrics();
}

function formatRupiah(value) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value);
}

function renderMetrics() {
  const items = state.items;
  const procurement = getProcurementSummary(items);
  byId('metric-total').textContent = items.length.toLocaleString('id-ID');
  byId('metric-order').textContent = items.filter((item) => (item.status || '').toUpperCase() === 'PESAN').length.toLocaleString('id-ID');
  byId('metric-safe').textContent = items.filter((item) => (item.status || '').toUpperCase() === 'TIDAK').length.toLocaleString('id-ID');
  byId('metric-value').textContent = formatRupiah(items.reduce((sum, item) => sum + (parseNumeric(item.max_value) || 0), 0));
  byId('metric-purchase-request').textContent = procurement.withPurchaseRequest.toLocaleString('id-ID');
  byId('metric-purchase-order').textContent = procurement.withPurchaseOrder.toLocaleString('id-ID');
  renderOrderValueChart(procurement);
}

function renderOrderValueChart({ orderValueBySubcategory, missingValueCount }) {
  const chart = byId('order-value-chart');
  const legend = byId('order-value-legend');
  const empty = byId('order-value-empty');
  const note = byId('order-value-note');
  const svg = byId('order-value-donut');
  const total = orderValueBySubcategory.reduce((sum, entry) => sum + entry.value, 0);
  byId('order-value-total').textContent = formatRupiah(total);
  byId('order-value-total-center').textContent = formatRupiah(total);
  svg.replaceChildren();
  legend.replaceChildren();
  chart.hidden = total <= 0;
  empty.hidden = total > 0;
  note.textContent = missingValueCount
    ? `${missingValueCount.toLocaleString('id-ID')} material PESAN tanpa PR/PO tidak masuk grafik karena Price atau ROP belum terisi sebagai angka.`
    : 'Nominal dihitung dari Price × ROP, dikelompokkan berdasarkan Part Category / Sub-Category.';
  if (total <= 0) return;

  const colors = ['#157f78', '#34768b', '#bc8d3c', '#bd594d', '#7864a5', '#4d936e', '#d07838', '#5073a3', '#aa6689', '#758b46'];
  let offset = 0;
  for (const [index, entry] of orderValueBySubcategory.entries()) {
    const circumference = 2 * Math.PI * 82;
    const segmentLength = (entry.value / total) * circumference;
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', '120');
    circle.setAttribute('cy', '120');
    circle.setAttribute('r', '82');
    circle.setAttribute('fill', 'none');
    circle.setAttribute('stroke', colors[index % colors.length]);
    circle.setAttribute('stroke-width', '34');
    circle.setAttribute('stroke-dasharray', `${segmentLength} ${circumference - segmentLength}`);
    circle.setAttribute('stroke-dashoffset', String(-offset));
    circle.setAttribute('transform', 'rotate(-90 120 120)');
    const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    title.textContent = `${entry.category} / ${entry.subCategory}: ${formatRupiah(entry.value)}`;
    circle.append(title);
    svg.append(circle);
    offset += segmentLength;

    const row = document.createElement('li');
    const swatch = document.createElement('span');
    swatch.className = 'chart-swatch';
    swatch.style.backgroundColor = colors[index % colors.length];
    swatch.setAttribute('aria-hidden', 'true');
    const description = document.createElement('span');
    description.className = 'chart-legend-description';
    const label = document.createElement('strong');
    label.textContent = `${entry.category} / ${entry.subCategory}`;
    const details = document.createElement('small');
    details.textContent = `${formatRupiah(entry.value)} · ${entry.itemCount.toLocaleString('id-ID')} item · ${((entry.value / total) * 100).toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`;
    description.append(label, details);
    row.append(swatch, description);
    legend.append(row);
  }
}

function renderFormSections() {
  const container = byId('form-sections');
  container.replaceChildren();
  const sections = [...new Set(fields.map((field) => field.section))];
  for (const section of sections) {
    const sectionElement = document.createElement('section');
    sectionElement.className = 'field-section';
    const title = document.createElement('h3');
    title.textContent = section;
    const grid = document.createElement('div');
    grid.className = 'field-grid';
    for (const field of fields.filter((item) => item.section === section)) {
      const label = document.createElement('label');
      label.className = 'form-field';
      const caption = document.createElement('span');
      caption.textContent = field.required ? `${field.label} *` : field.label;
      const input = field.type === 'status' ? document.createElement('select') : document.createElement('input');
      input.id = `field-${field.key}`;
      input.name = field.key;
      if (field.type === 'status') {
        for (const [value, text] of [['', 'Pilih status'], ['PESAN', 'PESAN'], ['TIDAK', 'TIDAK']]) {
          const option = document.createElement('option');
          option.value = value;
          option.textContent = text;
          input.append(option);
        }
      } else {
        input.type = 'text';
        input.maxLength = 500;
        input.autocomplete = 'off';
        if (field.required) input.required = true;
      }
      if (field.readonly) {
        input.disabled = true;
        input.setAttribute('aria-readonly', 'true');
      }
      label.append(caption, input);
      grid.append(label);
    }
    sectionElement.append(title, grid);
    container.append(sectionElement);
  }
  byId('field-stock_2026_10_20_update').addEventListener('input', updateFormStatus);
  byId('field-rop_minstock').addEventListener('input', updateFormStatus);
}

function updateFormStatus() {
  byId('field-status').value = getAutomaticStatus(
    byId('field-stock_2026_10_20_update').value,
    byId('field-rop_minstock').value,
  );
}

function renderUsageRows(usage = {}, extraMonths = latestMonthKeys()) {
  const container = byId('usage-entries');
  container.replaceChildren();
  const months = [...new Set([...Object.keys(usage), ...extraMonths])].sort().reverse();
  for (const month of months) addUsageRow(month, usage[month] ?? '');
}

function addUsageRow(month, quantity = '') {
  const container = byId('usage-entries');
  const row = document.createElement('div');
  row.className = 'usage-row';
  const monthInput = document.createElement('input');
  monthInput.type = 'month';
  monthInput.className = 'usage-month';
  monthInput.value = month;
  monthInput.setAttribute('aria-label', 'Bulan pemakaian');
  monthInput.required = true;
  const quantityInput = document.createElement('input');
  quantityInput.type = 'text';
  quantityInput.inputMode = 'decimal';
  quantityInput.className = 'usage-quantity';
  quantityInput.value = quantity;
  quantityInput.placeholder = 'Kosongkan jika belum ada data';
  quantityInput.setAttribute('aria-label', `Jumlah pemakaian ${formatMonthLabel(month)}`);
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'row-action delete';
  remove.textContent = '×';
  remove.setAttribute('aria-label', `Hapus baris ${formatMonthLabel(month)}`);
  remove.addEventListener('click', () => row.remove());
  row.append(monthInput, quantityInput, remove);
  container.append(row);
}

function openItemModal(item = null) {
  state.editingId = item?.id ?? null;
  byId('modal-title').textContent = item ? `Edit material · ${item.ppm}` : 'Tambah material';
  byId('save-button').textContent = item ? 'Simpan perubahan' : 'Simpan material';
  byId('form-error').hidden = true;
  for (const field of fields) byId(`field-${field.key}`).value = item?.[field.key] || '';
  updateFormStatus();
  renderUsageRows(item?.monthly_usage || {});
  byId('usage-month-picker').value = latestMonthKeys(1)[0];
  byId('item-modal').hidden = false;
  byId('field-ppm').focus();
}

function closeItemModal() {
  byId('item-modal').hidden = true;
  byId('item-form').reset();
  state.editingId = null;
}

async function loadItems() {
  const { error: calculationError } = await supabase.rpc('refresh_all_inventory_calculations');
  throwIfError(calculationError);
  const items = [];
  const usageRows = [];
  const pageSize = 1000;
  for (let start = 0; ; start += pageSize) {
    const { data, error } = await supabase.from('inventory_items')
      .select('*')
      .order('id', { ascending: true })
      .range(start, start + pageSize - 1);
    throwIfError(error);
    items.push(...data);
    if (data.length < pageSize) break;
  }
  for (let start = 0; ; start += pageSize) {
    const { data, error } = await supabase.from('inventory_monthly_usage')
      .select('inventory_item_id, usage_month, quantity')
      .order('usage_month', { ascending: true })
      .range(start, start + pageSize - 1);
    throwIfError(error);
    usageRows.push(...data);
    if (data.length < pageSize) break;
  }
  const usageByItem = new Map();
  for (const row of usageRows) {
    const usage = usageByItem.get(row.inventory_item_id) || {};
    usage[row.usage_month.slice(0, 7)] = row.quantity === null ? '' : String(row.quantity).replace('.', ',');
    usageByItem.set(row.inventory_item_id, usage);
  }
  for (const item of items) item.monthly_usage = usageByItem.get(item.id) || {};
  state.items = items;
  renderItems();
}

function openDeleteConfirmation({ title, description, item = null, warning = false, onConfirm }) {
  state.confirmAction = onConfirm;
  state.previousFocus = document.activeElement;
  byId('confirm-title').textContent = title;
  byId('confirm-description').textContent = description;
  byId('confirm-item').hidden = !item;
  byId('confirm-item').textContent = item
    ? `${item.ppm}${item.material_description ? ` · ${item.material_description}` : ''}`
    : '';
  byId('confirm-warning').hidden = !warning;
  byId('confirm-delete').disabled = false;
  byId('confirm-delete').innerHTML = '<span aria-hidden="true">⌫</span> Ya, hapus';
  byId('confirm-modal').hidden = false;
  byId('confirm-cancel').focus();
}

function closeDeleteConfirmation({ focusTarget = null } = {}) {
  byId('confirm-modal').hidden = true;
  state.confirmAction = null;
  const returnFocus = focusTarget
    || (state.previousFocus instanceof HTMLElement && state.previousFocus.isConnected ? state.previousFocus : null)
    || byId('search-input');
  returnFocus.focus();
  state.previousFocus = null;
}

async function deleteItem(item) {
  openDeleteConfirmation({
    title: 'Hapus material ini?',
    description: 'Material berikut akan dihapus dari daftar inventori.',
    item,
    onConfirm: async () => {
      byId('confirm-delete').disabled = true;
      byId('confirm-delete').textContent = 'Menghapus...';
      try {
        const { error } = await supabase.from('inventory_items').delete().eq('id', item.id);
        throwIfError(error);
        state.items = state.items.filter((row) => row.id !== item.id);
        renderItems();
        closeDeleteConfirmation({ focusTarget: byId('search-input') });
        showToast(`Material ${item.ppm} berhasil dihapus.`);
      } catch (error) {
        console.error('Failed to delete inventory item:', error);
        byId('confirm-delete').disabled = false;
        byId('confirm-delete').innerHTML = '<span aria-hidden="true">⌫</span> Ya, hapus';
        showToast(`Gagal menghapus material: ${error.message}`, true);
      }
    },
  });
}

async function checkHostSetup() {
  const { data, error } = await supabase.rpc('host_setup_required');
  throwIfError(error);
  return data;
}

async function initialize() {
  if (initializePromise) return initializePromise;
  initializePromise = initializeSession();
  try {
    return await initializePromise;
  } finally {
    initializePromise = null;
  }
}

async function initializeSession() {
  renderTableHead();
  renderFormSections();
  if (!supabase) {
    setAuthMode(false);
    byId('connection-status').lastChild.textContent = ' Supabase belum diatur';
    byId('connection-status').classList.add('disconnected');
    byId('auth-title').textContent = 'Hubungkan Supabase';
    byId('auth-description').textContent = 'Atur VITE_SUPABASE_URL dan VITE_SUPABASE_ANON_KEY di environment Netlify untuk mengaktifkan aplikasi.';
    byId('auth-submit').hidden = true;
    byId('auth-username').disabled = true;
    byId('auth-password').disabled = true;
    byId('results-count').textContent = 'Konfigurasi Supabase diperlukan.';
    return;
  }
  try {
    const [setupRequired, { data: { session } }] = await Promise.all([
      checkHostSetup(),
      supabase.auth.getSession(),
    ]);
    byId('connection-status').replaceChildren(
      Object.assign(document.createElement('i'), { 'aria-hidden': 'true' }),
      document.createTextNode(' Supabase terhubung'),
    );
    byId('connection-status').classList.remove('disconnected');
    state.setupRequired = setupRequired;
    const user = session?.user;
    if (!user) {
      state.user = null;
      byId('user-chip').textContent = '';
      byId('logout-button').hidden = true;
      setAuthMode(setupRequired);
      return;
    }
    const { data: profile, error } = await supabase.from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();
    throwIfError(error);
    if (profile.role !== 'HOST') {
      await supabase.auth.signOut();
      state.user = null;
      setAuthMode(setupRequired);
      byId('auth-error').textContent = 'Akun ini belum memiliki izin HOST.';
      byId('auth-error').hidden = false;
      return;
    }
    state.user = user;
    byId('auth-layer').hidden = true;
    byId('auth-submit').hidden = false;
    byId('auth-username').disabled = false;
    byId('auth-password').disabled = false;
    byId('user-chip').textContent = `${user.email} · HOST`;
    byId('logout-button').hidden = false;
    await loadItems();
  } catch (error) {
    byId('connection-status').textContent = 'Supabase tidak terhubung';
    byId('connection-status').classList.add('disconnected');
    showToast(`Supabase: ${error.message}`, true);
    byId('results-count').textContent = 'Tidak dapat memuat data Supabase.';
  }
}

async function getExcelLibrary() {
  if (!excelLibraryPromise) excelLibraryPromise = import('@e965/xlsx');
  return excelLibraryPromise;
}

async function createExcelWorkbook(rows, filename) {
  const XLSX = await getExcelLibrary();
  const recordedMonths = [...new Set(rows.flatMap((item) => Object.keys(item.monthly_usage || {})))].sort();
  const months = recordedMonths.length
    ? monthRange(recordedMonths[0], recordedMonths[recordedMonths.length - 1])
    : latestMonthKeys();
  const identityFields = fields.slice(0, 4);
  const remainingFields = fields.slice(4);
  const columns = [
    ...identityFields.map((field) => ({ label: field.label, value: (item) => item[field.key] || '' })),
    ...months.map((month) => ({
      label: formatMonthLabel(month),
      value: (item) => {
        const quantity = item.monthly_usage?.[month];
        return quantity === undefined || quantity === '' ? '' : Number(String(quantity).replace(',', '.'));
      },
    })),
    ...remainingFields.map((field) => ({ label: field.label, value: (item) => item[field.key] || '' })),
  ];
  const worksheetData = [
    columns.map((column) => column.label),
    ...rows.map((item) => columns.map((column) => column.value(item))),
  ];
  const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);
  worksheet['!cols'] = columns.map((column) => ({ wch: Math.max(12, Math.min(column.label.length + 3, 30)) }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Inventory');
  XLSX.writeFile(workbook, filename, { compression: true });
}

function parseExcelRows(workbook, XLSX) {
  const worksheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!worksheet) throw new Error('Workbook Excel tidak memiliki sheet data.');
  const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '', raw: true });
  if (!rows.length) throw new Error('Sheet Excel tidak memiliki header.');
  const headers = rows[0].map((value) => String(value).trim().toUpperCase());
  if (!headers.some((header) => headerMap.get(header) === 'ppm')) {
    throw new Error('Kolom PPM wajib tersedia pada header Excel.');
  }
  const monthColumns = headers.map(parseMonthHeader);
  const uniqueMonths = monthColumns.filter(Boolean);
  if (new Set(uniqueMonths).size !== uniqueMonths.length) {
    throw new Error('Header bulan pada Excel tidak boleh duplikat.');
  }
  const inputRows = rows.slice(1).filter((row) => row.some((value) => String(value).trim() !== ''));
  if (!inputRows.length) throw new Error('Tidak ada baris data untuk diimpor.');
  if (inputRows.length > 10000) throw new Error('Maksimal 10.000 baris dapat diimpor sekaligus.');
  const seenPpm = new Set();
  const items = [];
  const usage = [];
  inputRows.forEach((row, index) => {
    const item = Object.fromEntries(fields.map((field) => [field.key, '']));
    headers.forEach((header, columnIndex) => {
      const key = headerMap.get(header);
      if (key && !fields.find((field) => field.key === key)?.readonly) {
        item[key] = String(row[columnIndex] ?? '').trim();
      }
    });
    for (const field of fields) {
      if (item[field.key].length > 500) throw new Error(`Baris ${index + 2}: nilai kolom ${field.label} melebihi 500 karakter.`);
    }
    if (!item.ppm) throw new Error(`Baris ${index + 2}: PPM wajib diisi.`);
    if (seenPpm.has(item.ppm)) throw new Error(`Baris ${index + 2}: PPM ${item.ppm} muncul lebih dari sekali.`);
    seenPpm.add(item.ppm);
    monthColumns.forEach((month, columnIndex) => {
      const rawQuantity = String(row[columnIndex] ?? '').trim();
      if (!month || !rawQuantity) return;
      const cellValue = row[columnIndex];
      const quantity = typeof cellValue === 'number' ? cellValue : parseNumeric(rawQuantity);
      if (quantity === null) {
        throw new Error(`Baris ${index + 2}: nilai pemakaian ${formatMonthLabel(month)} bukan angka.`);
      }
      usage.push({ ppm: item.ppm, usage_month: `${month}-01`, quantity });
    });
    items.push(item);
  });
  return { items, usage };
}

async function importExcel(file) {
  if (file.size > 10 * 1024 * 1024) throw new Error('Ukuran berkas melebihi batas 10 MB.');
  const XLSX = await getExcelLibrary();
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', raw: false });
  const { items, usage } = parseExcelRows(workbook, XLSX);
  const { data, error } = await supabase.rpc('import_inventory_with_history', { items, monthly_values: usage });
  throwIfError(error);
  await loadItems();
  showToast(`Impor Excel berhasil. ${data} baris ditambahkan atau diperbarui.`);
}

function updateActiveNavigation() {
  const current = window.location.hash || '#dashboard';
  document.querySelectorAll('.nav-link').forEach((link) => {
    link.classList.toggle('active', link.getAttribute('href') === current);
  });
}

byId('auth-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const errorBox = byId('auth-error');
  errorBox.hidden = true;
  const email = byId('auth-username').value.trim();
  const password = byId('auth-password').value;
  try {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    throwIfError(error);
    await initialize();
  } catch (error) {
    errorBox.textContent = error.message;
    errorBox.hidden = false;
  }
});

byId('logout-button').addEventListener('click', async () => {
  const { error } = await supabase.auth.signOut();
  if (error) {
    showToast(error.message, true);
    return;
  }
  state.items = [];
  state.user = null;
  await initialize();
});

byId('add-button').addEventListener('click', () => openItemModal());
byId('empty-add-button').addEventListener('click', () => openItemModal());
byId('usage-add-month').addEventListener('click', () => {
  const month = byId('usage-month-picker').value;
  if (!month) {
    byId('usage-month-picker').focus();
    return;
  }
  const existing = [...byId('usage-entries').querySelectorAll('.usage-month')].find((input) => input.value === month);
  if (existing) {
    existing.focus();
    return;
  }
  addUsageRow(month);
  byId('usage-entries').lastElementChild.querySelector('.usage-month').focus();
});
byId('modal-close').addEventListener('click', closeItemModal);
byId('cancel-button').addEventListener('click', closeItemModal);
byId('confirm-cancel').addEventListener('click', closeDeleteConfirmation);
byId('confirm-modal').addEventListener('click', (event) => {
  if (event.target === byId('confirm-modal')) closeDeleteConfirmation();
});
byId('confirm-delete').addEventListener('click', async () => {
  if (state.confirmAction) await state.confirmAction();
});
byId('item-modal').addEventListener('click', (event) => {
  if (event.target === byId('item-modal')) closeItemModal();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Tab' && !byId('confirm-modal').hidden) {
    const dialog = byId('confirm-modal').querySelector('.confirm-dialog');
    const focusable = [...dialog.querySelectorAll('button:not(:disabled):not([hidden])')];
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    } else if (!dialog.contains(document.activeElement)) {
      event.preventDefault();
      first.focus();
    }
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    byId('search-input').focus();
  }
  if (event.key === 'Escape' && !byId('item-modal').hidden) closeItemModal();
  if (event.key === 'Escape' && !byId('confirm-modal').hidden) closeDeleteConfirmation();
});

byId('item-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const formError = byId('form-error');
  formError.hidden = true;
  const item = Object.fromEntries(fields
    .filter((field) => !field.readonly)
    .map((field) => [field.key, byId(`field-${field.key}`).value.trim()]));
  const wasEditing = state.editingId !== null;
  const originalItem = state.items.find((row) => row.id === state.editingId);
  byId('save-button').disabled = true;
  byId('save-button').textContent = 'Menyimpan...';
  try {
    const usage = new Map();
    for (const row of byId('usage-entries').querySelectorAll('.usage-row')) {
      const month = row.querySelector('.usage-month').value;
      const rawQuantity = row.querySelector('.usage-quantity').value.trim();
      if (!month) throw new Error('Pilih bulan untuk setiap baris histori.');
      if (usage.has(month)) throw new Error(`Bulan ${formatMonthLabel(month)} dicantumkan lebih dari sekali.`);
      if (!rawQuantity) continue;
      const quantity = parseNumeric(rawQuantity);
      if (quantity === null) throw new Error(`Jumlah pemakaian ${formatMonthLabel(month)} harus berupa angka.`);
      usage.set(month, quantity);
    }
    const retainedMonths = new Set(usage.keys());
    const monthsToDelete = Object.keys(originalItem?.monthly_usage || {})
      .filter((month) => !retainedMonths.has(month))
      .map((month) => `${month}-01`);
    const { error } = await supabase.rpc('save_inventory_item_with_history', {
      item_data: item,
      history: [...usage].map(([month, quantity]) => ({ usage_month: `${month}-01`, quantity })),
      deleted_months: monthsToDelete,
      inventory_item_id: state.editingId,
    });
    throwIfError(error);
    await loadItems();
    closeItemModal();
    showToast(wasEditing ? 'Perubahan material berhasil disimpan.' : 'Material berhasil ditambahkan.');
  } catch (error) {
    formError.textContent = error.message;
    formError.hidden = false;
  } finally {
    byId('save-button').disabled = false;
    byId('save-button').textContent = wasEditing ? 'Simpan perubahan' : 'Simpan material';
  }
});

byId('search-input').addEventListener('input', renderItems);
byId('status-filter').addEventListener('change', renderItems);
byId('import-button').addEventListener('click', () => byId('import-input').click());
byId('import-input').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    await importExcel(file);
  } catch (error) {
    showToast(error.message, true);
  } finally {
    event.target.value = '';
  }
});
byId('template-button').addEventListener('click', async () => {
  try {
    await createExcelWorkbook([], 'template-inventory-order-control.xlsx');
  } catch (error) {
    showToast(error.message, true);
  }
});
byId('export-button').addEventListener('click', async () => {
  try {
    await createExcelWorkbook(state.items, 'inventory-order-control.xlsx');
  } catch (error) {
    showToast(error.message, true);
  }
});
byId('delete-all-button').addEventListener('click', async () => {
  if (!state.items.length) {
    showToast('Belum ada data material yang dapat dihapus.');
    return;
  }
  const count = state.items.length;
  openDeleteConfirmation({
    title: 'Hapus semua material?',
    description: `Anda akan menghapus ${count.toLocaleString('id-ID')} material dari inventori.`,
    warning: true,
    onConfirm: async () => {
      byId('confirm-delete').disabled = true;
      byId('confirm-delete').textContent = 'Menghapus...';
      try {
        const { data, error } = await supabase.rpc('delete_all_inventory');
        throwIfError(error);
        state.items = [];
        renderItems();
        closeDeleteConfirmation({ focusTarget: byId('add-button') });
        showToast(`${Number(data).toLocaleString('id-ID')} material berhasil dihapus.`);
      } catch (error) {
        console.error('Failed to delete all inventory items:', error);
        byId('confirm-delete').disabled = false;
        byId('confirm-delete').innerHTML = '<span aria-hidden="true">⌫</span> Ya, hapus';
        showToast(`Gagal menghapus semua data: ${error.message}`, true);
      }
    },
  });
});

window.addEventListener('hashchange', updateActiveNavigation);
updateActiveNavigation();
initialize();
