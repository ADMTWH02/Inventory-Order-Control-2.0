import { createClient } from '@supabase/supabase-js';

const fields = [
  { key: 'ppm', label: 'PPM', section: 'Identitas material', required: true },
  { key: 'material_description', label: 'Material description', section: 'Identitas material' },
  { key: 'part_category', label: 'Part category', section: 'Identitas material' },
  { key: 'sub_category', label: 'Sub-category', section: 'Identitas material' },
  { key: 'jan_26', label: 'Jan 26', section: 'Pemakaian bulanan' },
  { key: 'feb_26', label: 'Feb 26', section: 'Pemakaian bulanan' },
  { key: 'mar_26', label: 'Mar 26', section: 'Pemakaian bulanan' },
  { key: 'apr_26', label: 'Apr 26', section: 'Pemakaian bulanan' },
  { key: 'may_26', label: 'Mei 26', section: 'Pemakaian bulanan' },
  { key: 'jun_26', label: 'Jun 26', section: 'Pemakaian bulanan' },
  { key: 'jul_26', label: 'Jul 26', section: 'Pemakaian bulanan' },
  { key: 'aug_26', label: 'Aug 26', section: 'Pemakaian bulanan' },
  { key: 'sep_26', label: 'Sep 26', section: 'Pemakaian bulanan' },
  { key: 'average_monthly_update', label: 'Average/M (update)', section: 'Parameter perencanaan' },
  { key: 'average', label: 'Average', section: 'Parameter perencanaan' },
  { key: 'average_daily', label: 'Average/D', section: 'Parameter perencanaan' },
  { key: 'lead_time_full', label: 'Lead time full', section: 'Parameter perencanaan' },
  { key: 'cycle_stock', label: 'Cycle stock', section: 'Parameter perencanaan' },
  { key: 'service_factor', label: 'Service factor', section: 'Parameter perencanaan' },
  { key: 'lead_time_factor', label: 'Lead time factor', section: 'Parameter perencanaan' },
  { key: 'standard_deviation_update', label: 'Standard dev. (update)', section: 'Parameter perencanaan' },
  { key: 'safety_stock', label: 'Safety stock', section: 'Parameter perencanaan' },
  { key: 'lead_time', label: 'Lead time', section: 'Parameter perencanaan' },
  { key: 'max_stock', label: 'Max. stock', section: 'Parameter perencanaan' },
  { key: 'status', label: 'Status', section: 'Kontrol stok', type: 'status' },
  { key: 'price', label: 'Price', section: 'Kontrol stok' },
  { key: 'max_value', label: 'Max. value', section: 'Kontrol stok' },
  { key: 'stock_2026_10_20_update', label: 'Stock 20.10.2026 (update)', section: 'Kontrol stok' },
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
const state = { items: [], user: null, editingId: null, setupRequired: false, toastTimer: null };
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
  for (const field of fields) {
    const th = document.createElement('th');
    th.textContent = field.label;
    row.append(th);
  }
  const actions = document.createElement('th');
  actions.textContent = 'AKSI';
  row.append(actions);
  byId('table-head').replaceChildren(row);
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
    td.textContent = value;
    if (field.key === 'material_description') td.classList.add('material-cell');
    if (['part_category', 'sub_category'].includes(field.key)) td.classList.add('category-cell');
    if (field.key === 'price' && value !== '—') td.textContent = `Rp ${value}`;
  }
  return td;
}

function visibleItems() {
  const search = byId('search-input').value.trim().toLocaleLowerCase('id');
  const status = byId('status-filter').value;
  return state.items.filter((item) => {
    if (status && (item.status || '').toUpperCase() !== status) return false;
    return !search || fields.some((field) =>
      (item[field.key] || '').toLocaleLowerCase('id').includes(search));
  });
}

function renderItems() {
  const list = visibleItems();
  const body = byId('table-body');
  const rows = list.map((item) => {
    const row = document.createElement('tr');
    for (const field of fields) row.append(valueCell(item, field));
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

function parseNumeric(value) {
  let cleaned = String(value || '').replace(/[^\d,.-]/g, '');
  const comma = cleaned.lastIndexOf(',');
  const dot = cleaned.lastIndexOf('.');
  if (comma >= 0 && dot >= 0) {
    cleaned = comma > dot
      ? cleaned.replace(/\./g, '').replace(',', '.')
      : cleaned.replace(/,/g, '');
  } else if (comma >= 0) {
    cleaned = cleaned.replace(',', '.');
  } else if ((cleaned.match(/\./g) || []).length > 1 || (dot >= 0 && cleaned.length - dot - 1 === 3)) {
    cleaned = cleaned.replace(/\./g, '');
  }
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : 0;
}

function formatRupiah(value) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value);
}

function renderMetrics() {
  const items = state.items;
  byId('metric-total').textContent = items.length.toLocaleString('id-ID');
  byId('metric-order').textContent = items.filter((item) => (item.status || '').toUpperCase() === 'PESAN').length.toLocaleString('id-ID');
  byId('metric-safe').textContent = items.filter((item) => (item.status || '').toUpperCase() === 'TIDAK').length.toLocaleString('id-ID');
  byId('metric-value').textContent = formatRupiah(items.reduce((sum, item) => sum + parseNumeric(item.max_value), 0));
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
      label.append(caption, input);
      grid.append(label);
    }
    sectionElement.append(title, grid);
    container.append(sectionElement);
  }
}

function openItemModal(item = null) {
  state.editingId = item?.id ?? null;
  byId('modal-title').textContent = item ? `Edit material · ${item.ppm}` : 'Tambah material';
  byId('save-button').textContent = item ? 'Simpan perubahan' : 'Simpan material';
  byId('form-error').hidden = true;
  for (const field of fields) byId(`field-${field.key}`).value = item?.[field.key] || '';
  byId('item-modal').hidden = false;
  byId('field-ppm').focus();
}

function closeItemModal() {
  byId('item-modal').hidden = true;
  byId('item-form').reset();
  state.editingId = null;
}

async function loadItems() {
  const items = [];
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
  state.items = items;
  renderItems();
}

async function deleteItem(item) {
  if (!window.confirm(`Hapus material ${item.ppm} — ${item.material_description || ''}?`)) return;
  try {
    const { error } = await supabase.from('inventory_items').delete().eq('id', item.id);
    throwIfError(error);
    state.items = state.items.filter((row) => row.id !== item.id);
    renderItems();
    showToast(`Material ${item.ppm} berhasil dihapus.`);
  } catch (error) {
    showToast(error.message, true);
  }
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
  const worksheetData = [
    fields.map((field) => field.label),
    ...rows.map((item) => fields.map((field) => item[field.key] || '')),
  ];
  const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);
  worksheet['!cols'] = fields.map((field) => ({ wch: Math.max(12, Math.min(field.label.length + 3, 30)) }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Inventory');
  XLSX.writeFile(workbook, filename, { compression: true });
}

function parseExcelRows(workbook, XLSX) {
  const worksheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!worksheet) throw new Error('Workbook Excel tidak memiliki sheet data.');
  const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '', raw: false });
  if (!rows.length) throw new Error('Sheet Excel tidak memiliki header.');
  const headers = rows[0].map((value) => String(value).trim().toUpperCase());
  if (!headers.some((header) => headerMap.get(header) === 'ppm')) {
    throw new Error('Kolom PPM wajib tersedia pada header Excel.');
  }
  const inputRows = rows.slice(1).filter((row) => row.some((value) => String(value).trim() !== ''));
  if (!inputRows.length) throw new Error('Tidak ada baris data untuk diimpor.');
  if (inputRows.length > 10000) throw new Error('Maksimal 10.000 baris dapat diimpor sekaligus.');
  return inputRows.map((row, index) => {
    const item = Object.fromEntries(fields.map((field) => [field.key, '']));
    headers.forEach((header, columnIndex) => {
      const key = headerMap.get(header);
      if (key) item[key] = String(row[columnIndex] ?? '').trim();
    });
    for (const field of fields) {
      if (item[field.key].length > 500) throw new Error(`Baris ${index + 2}: nilai kolom ${field.label} melebihi 500 karakter.`);
    }
    if (!item.ppm) throw new Error(`Baris ${index + 2}: PPM wajib diisi.`);
    return item;
  });
}

async function importExcel(file) {
  if (file.size > 10 * 1024 * 1024) throw new Error('Ukuran berkas melebihi batas 10 MB.');
  const XLSX = await getExcelLibrary();
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', raw: false });
  const items = parseExcelRows(workbook, XLSX);
  const { data, error } = await supabase.rpc('import_inventory', { items });
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
byId('modal-close').addEventListener('click', closeItemModal);
byId('cancel-button').addEventListener('click', closeItemModal);
byId('item-modal').addEventListener('click', (event) => {
  if (event.target === byId('item-modal')) closeItemModal();
});
document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    byId('search-input').focus();
  }
  if (event.key === 'Escape' && !byId('item-modal').hidden) closeItemModal();
});

byId('item-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const formError = byId('form-error');
  formError.hidden = true;
  const item = Object.fromEntries(fields.map((field) => [field.key, byId(`field-${field.key}`).value.trim()]));
  const wasEditing = state.editingId !== null;
  try {
    const result = wasEditing
      ? await supabase.from('inventory_items').update(item).eq('id', state.editingId)
      : await supabase.from('inventory_items').insert(item);
    throwIfError(result.error);
    await loadItems();
    closeItemModal();
    showToast(wasEditing ? 'Perubahan material berhasil disimpan.' : 'Material berhasil ditambahkan.');
  } catch (error) {
    formError.textContent = error.message;
    formError.hidden = false;
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
    showToast('Tidak ada data untuk dihapus.');
    return;
  }
  if (window.prompt(`Tindakan ini akan menghapus ${state.items.length} material secara permanen. Ketik HAPUS untuk melanjutkan.`) !== 'HAPUS') return;
  try {
    const { data, error } = await supabase.rpc('delete_all_inventory');
    throwIfError(error);
    state.items = [];
    renderItems();
    showToast(`${data} data berhasil dihapus.`);
  } catch (error) {
    showToast(error.message, true);
  }
});

window.addEventListener('hashchange', updateActiveNavigation);
updateActiveNavigation();
initialize();
