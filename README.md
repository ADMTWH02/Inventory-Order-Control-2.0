# Inventory Order Control

Aplikasi inventori material kritis dengan file Excel `.xlsx`, Supabase Auth/Database, dan konfigurasi deploy Netlify.

## 1. Siapkan Supabase

1. Buat project di [Supabase](https://supabase.com/dashboard).
2. Buka **SQL Editor**, lalu jalankan seluruh isi [`supabase/schema.sql`](./supabase/schema.sql). Schema ini membuat tabel, trigger profil, fungsi setup akun HOST, impor Excel, hapus semua data, serta kebijakan Row Level Security.
3. Salin **Project URL** dan **publishable/anon key** dari Project Settings → API Keys. Jangan pernah menaruh `service_role` key di aplikasi web.
4. Pada Authentication → Sign In / Providers → Email, nonaktifkan pendaftaran pengguna publik (**Allow new users to sign up**). Akun HOST dibuat oleh pemilik project lewat dashboard supaya pihak lain tidak dapat merebut akun HOST pertama.
5. Buka Authentication → Users → Add user, buat pengguna admin, dan konfirmasi emailnya.
6. Jalankan SQL berikut di SQL Editor untuk memberi role HOST (ganti email):

   ```sql
   update public.profiles as p
   set role = 'HOST'
   from auth.users as u
   where p.id = u.id
     and u.email = 'admin@perusahaan.com';
   ```

7. Atur Authentication → URL Configuration: **Site URL** ke URL Netlify dan tambahkan URL deploy/preview ke **Redirect URLs**.

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

Tombol **Template Excel** mengunduh workbook `.xlsx` kosong berisi header sesuai gambar. **Import Excel** membaca `.xlsx`/`.xls` dengan PPM wajib; PPM yang sudah ada akan diperbarui. **Export Excel** mengunduh seluruh data inventori. Batas impor 10.000 baris dan 10 MB.

Menu navigasi: **Ringkasan**, **Inventori**, dan **Import / Export**. Kolom data mencakup PPM, deskripsi/kategori, pemakaian bulanan JAN–SEP 26, rata-rata, parameter stok, status, harga, ROP/ROQ, order/purchasing, durasi, dan minimum order quantity.
