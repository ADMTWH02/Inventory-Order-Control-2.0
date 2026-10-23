# Inventory Order Control

Aplikasi inventori material kritis dengan file Excel `.xlsx`, Supabase Auth/Database, dan konfigurasi deploy Netlify.

## 1. Siapkan Supabase

1. Buat project di [Supabase](https://supabase.com/dashboard).
2. Buka **SQL Editor**, lalu jalankan seluruh isi [`supabase/schema.sql`](./supabase/schema.sql).
3. Masih di SQL Editor, jalankan seluruh isi migration [`202610240001_monthly_usage_and_automatic_calculations.sql`](./supabase/migrations/202610240001_monthly_usage_and_automatic_calculations.sql). Migration ini membuat penyimpanan histori per bulan, memindahkan data JAN–SEP 26 lama, menghitung ulang Average/M dan Standard Dev. secara otomatis, serta menjaga status PESAN berdasarkan stok dan ROP. Migration wajib dijalankan sebelum memakai versi aplikasi terbaru.
4. Salin **Project URL** dan **publishable/anon key** dari Project Settings → API Keys. Jangan pernah menaruh `service_role` key di aplikasi web.
5. Pada Authentication → Sign In / Providers → Email, nonaktifkan pendaftaran pengguna publik (**Allow new users to sign up**). Akun HOST dibuat oleh pemilik project lewat dashboard supaya pihak lain tidak dapat merebut akun HOST pertama.
6. Buka Authentication → Users → Add user, buat pengguna admin, dan konfirmasi emailnya.
7. Jalankan SQL berikut di SQL Editor untuk memberi role HOST (ganti email):

   ```sql
   update public.profiles as p
   set role = 'HOST'
   from auth.users as u
   where p.id = u.id
     and u.email = 'admin@perusahaan.com';
   ```

8. Atur Authentication → URL Configuration: **Site URL** ke URL Netlify dan tambahkan URL deploy/preview ke **Redirect URLs**.

Jika belum ada HOST, halaman menampilkan instruksi penyiapan. Setelah role ditetapkan, masuk memakai email dan kata sandi yang dibuat di Supabase Dashboard. Profil pengguna lain secara default mendapat role `USER`. Kebijakan RLS membatasi tabel inventori hanya untuk HOST; aplikasi hanya menggunakan publishable/anon key.

## 2. Jalankan lokal

Memerlukan Node.js 20.19 atau lebih baru.

```powershell
npm install
Copy-Item .env.example .env.local
```

Isi `.env.local` dengan URL dan publishable/anon key dari project Supabase:

```text
VITE_SUPABASE_URL=https://project-id.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_...
```

Lalu jalankan:

```powershell
npm run dev
```

Buka URL localhost yang dicetak Vite. Jangan commit `.env.local`.

Jalankan tes perhitungan dan parsing header Excel dengan:

```powershell
npm test
```

## 3. Deploy ke Netlify

1. Hubungkan repository proyek ke Netlify (**Add new site → Import an existing project**) atau unggah hasil build melalui Netlify CLI.
2. Netlify menggunakan `netlify.toml`: build command `npm run build`, publish directory `dist`.
3. Di **Site configuration → Environment variables**, tambahkan `VITE_SUPABASE_URL` dan `VITE_SUPABASE_ANON_KEY`.
4. Deploy/redeploy. Atur URL deploy Netlify pada Supabase Authentication URL Configuration sebelum mendaftar akun HOST.

Untuk membuat build lokal:

```powershell
npm run build
```

Build statis berada di `dist`. Kredensial Supabase dimasukkan saat build sebagai variabel `VITE_*`; publishable/anon key memang boleh ada di browser karena akses data dikendalikan RLS. `service_role` key tidak diperlukan dan tidak boleh diberikan ke Netlify frontend.

## Excel dan data

Tombol **Template Excel** mengunduh workbook `.xlsx` kosong dengan kolom pemakaian untuk enam bulan berjalan. **Import Excel** membaca `.xlsx`/`.xls` dengan PPM wajib; PPM yang sudah ada akan diperbarui dan nilai bulan akan disimpan sebagai histori. Format header bulan yang dikenali meliputi `Jan 26`, `JAN-2026`, dan `2026-01`. Nilai kosong pada impor tidak menghapus histori yang sudah ada. **Export Excel** menyertakan seluruh histori yang tersimpan.

Form edit material menampilkan histori bulanan dan memungkinkan bulan lama diperbarui atau bulan baru ditambahkan. Average/M dihitung dengan prinsip `AVERAGE` Excel dari enam bulan kalender sampai bulan terbaru yang memiliki data; setelah pemakaian bulan baru disimpan, rentangnya bergeser otomatis. Angka nol disertakan dan sel kosong diabaikan. Standard Dev. memakai rumus sampel Excel `STDEV` pada rentang bulan yang sama. Status menjadi **PESAN** saat stok kurang dari ROP dan **TIDAK** saat stok sama dengan atau lebih dari ROP; jika salah satu angka tidak valid, status dikosongkan.

Menu navigasi: **Ringkasan**, **Inventori**, dan **Import / Export**. Kolom data mencakup PPM, deskripsi/kategori, enam bulan pemakaian terbaru, rata-rata, parameter stok, status, harga, ROP/ROQ, order/purchasing, durasi, dan minimum order quantity.

Ringkasan juga menampilkan jumlah material dengan Purchase Requisition dan Purchase Order terisi. Grafik donut merangkum nilai `Price × Qty order` untuk material berstatus `PESAN` yang kedua kolom PR dan PO-nya kosong, dibagi berdasarkan kombinasi Part Category dan Sub-Category. Material tanpa angka Price atau Qty order tidak dihitung dalam nilai grafik dan ditampilkan pada catatan grafik.

### Memperbarui fungsi Supabase

Setiap perubahan `supabase/migrations/*.sql` perlu dijalankan di Supabase Dashboard → SQL Editor. Untuk fitur histori bulanan, jalankan [`202610240001_monthly_usage_and_automatic_calculations.sql`](./supabase/migrations/202610240001_monthly_usage_and_automatic_calculations.sql). Aplikasi tidak dapat mengubah skema atau fungsi database hanya dengan deploy Netlify.
