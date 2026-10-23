create table if not exists public.inventory_monthly_usage (
  inventory_item_id bigint not null references public.inventory_items (id) on delete cascade,
  usage_month date not null check (extract(day from usage_month) = 1),
  quantity numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (inventory_item_id, usage_month)
);
create index if not exists inventory_monthly_usage_latest_month_idx
on public.inventory_monthly_usage (usage_month desc)
where quantity is not null;

create or replace function public.parse_inventory_numeric(input_value text)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  parsed_value text := regexp_replace(btrim(coalesce(input_value, '')), '[^0-9,.\-]', '', 'g');
  comma_position integer;
  dot_position integer;
begin
  if parsed_value = '' or parsed_value !~ '^-?[0-9][0-9.,]*$' then
    return null;
  end if;

  comma_position := strpos(parsed_value, ',');
  dot_position := strpos(parsed_value, '.');
  if comma_position > 0 and dot_position > 0 then
    if strpos(reverse(parsed_value), ',') < strpos(reverse(parsed_value), '.') then
      parsed_value := replace(replace(parsed_value, '.', ''), ',', '.');
    else
      parsed_value := replace(parsed_value, ',', '');
    end if;
  elsif comma_position > 0 then
    parsed_value := replace(replace(parsed_value, '.', ''), ',', '.');
  elsif dot_position > 0 and parsed_value !~ '^-?0\.[0-9]+$'
    and parsed_value ~ '^-?[0-9]{1,3}(\.[0-9]{3})+$' then
    parsed_value := replace(parsed_value, '.', '');
  end if;

  return parsed_value::numeric;
exception
  when invalid_text_representation or numeric_value_out_of_range then
    return null;
end;
$$;

create or replace function public.set_inventory_order_status()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  stock_value numeric;
  rop_value numeric;
begin
  stock_value := public.parse_inventory_numeric(new.stock_2026_10_20_update);
  rop_value := public.parse_inventory_numeric(new.rop_minstock);
  if stock_value is null or rop_value is null then
    new.status := '';
  elsif stock_value < rop_value then
    new.status := 'PESAN';
  else
    new.status := 'TIDAK';
  end if;
  return new;
end;
$$;

drop trigger if exists set_inventory_order_status on public.inventory_items;
create trigger set_inventory_order_status
before insert or update of stock_2026_10_20_update, rop_minstock
on public.inventory_items
for each row execute function public.set_inventory_order_status();

create or replace function public.refresh_inventory_monthly_calculations()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_item_id bigint;
  latest_usage_month date;
  average_value numeric;
  deviation_value numeric;
begin
  if tg_op = 'DELETE' then
    target_item_id := old.inventory_item_id;
  else
    target_item_id := new.inventory_item_id;
  end if;

  select max(usage_month)
  into latest_usage_month
  from public.inventory_monthly_usage
  where quantity is not null;

  select avg(quantity), stddev_samp(quantity)
  into average_value, deviation_value
  from public.inventory_monthly_usage
  where inventory_item_id = target_item_id
    and latest_usage_month is not null
    and usage_month >= (date_trunc('month', latest_usage_month) - interval '5 months')::date
    and usage_month < (date_trunc('month', latest_usage_month) + interval '1 month')::date;

  update public.inventory_items
  set average_monthly_update = coalesce(average_value::text, ''),
      standard_deviation_update = coalesce(deviation_value::text, ''),
      status = case
        when public.parse_inventory_numeric(stock_2026_10_20_update) is null
          or public.parse_inventory_numeric(rop_minstock) is null then ''
        when public.parse_inventory_numeric(stock_2026_10_20_update)
          < public.parse_inventory_numeric(rop_minstock) then 'PESAN'
        else 'TIDAK'
      end
  where id = target_item_id;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists refresh_inventory_monthly_calculations on public.inventory_monthly_usage;
create trigger refresh_inventory_monthly_calculations
after insert or update or delete on public.inventory_monthly_usage
for each row execute function public.refresh_inventory_monthly_calculations();

create or replace function public.refresh_all_inventory_calculations()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  refreshed_count integer;
begin
  if not public.is_inventory_host() then
    raise exception 'Akses hanya tersedia untuk akun HOST.';
  end if;

  with latest_usage as (
    select max(usage_month) as latest_usage_month
    from public.inventory_monthly_usage
    where quantity is not null
  ), calculations as (
    select
      item.id,
      coalesce(usage_stats.average_value::text, '') as average_value,
      coalesce(usage_stats.deviation_value::text, '') as deviation_value,
      case
        when public.parse_inventory_numeric(item.stock_2026_10_20_update) is null
          or public.parse_inventory_numeric(item.rop_minstock) is null then ''
        when public.parse_inventory_numeric(item.stock_2026_10_20_update)
          < public.parse_inventory_numeric(item.rop_minstock) then 'PESAN'
        else 'TIDAK'
      end as status_value
    from public.inventory_items as item
    cross join latest_usage
    cross join lateral (
      select avg(quantity) as average_value, stddev_samp(quantity) as deviation_value
      from public.inventory_monthly_usage
      where inventory_item_id = item.id
        and latest_usage.latest_usage_month is not null
        and usage_month >= (date_trunc('month', latest_usage.latest_usage_month) - interval '5 months')::date
        and usage_month < (date_trunc('month', latest_usage.latest_usage_month) + interval '1 month')::date
    ) as usage_stats
  )
  update public.inventory_items as item
  set average_monthly_update = calculations.average_value,
      standard_deviation_update = calculations.deviation_value,
      status = calculations.status_value
  from calculations
  where item.id = calculations.id
    and (
      item.average_monthly_update is distinct from calculations.average_value
      or item.standard_deviation_update is distinct from calculations.deviation_value
      or item.status is distinct from calculations.status_value
    );

  get diagnostics refreshed_count = row_count;
  return refreshed_count;
end;
$$;

create or replace function public.set_inventory_monthly_usage_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_inventory_monthly_usage_updated_at on public.inventory_monthly_usage;
create trigger set_inventory_monthly_usage_updated_at
before update on public.inventory_monthly_usage
for each row execute function public.set_inventory_monthly_usage_updated_at();

alter table public.inventory_monthly_usage enable row level security;
drop policy if exists "HOST can manage monthly inventory usage" on public.inventory_monthly_usage;
create policy "HOST can manage monthly inventory usage"
on public.inventory_monthly_usage for all to authenticated
using ((select public.is_inventory_host()))
with check ((select public.is_inventory_host()));

grant select, insert, update, delete on public.inventory_monthly_usage to authenticated;
grant execute on function public.parse_inventory_numeric(text) to authenticated;
revoke all on function public.set_inventory_order_status() from public, anon, authenticated;
revoke all on function public.refresh_inventory_monthly_calculations() from public, anon, authenticated;
revoke all on function public.refresh_all_inventory_calculations() from public, anon;
grant execute on function public.refresh_all_inventory_calculations() to authenticated;
revoke all on function public.set_inventory_monthly_usage_updated_at() from public, anon, authenticated;

insert into public.inventory_monthly_usage (inventory_item_id, usage_month, quantity)
select items.id, legacy.usage_month, public.parse_inventory_numeric(legacy.quantity)
from public.inventory_items as items
cross join lateral (values
  (date '2026-01-01', items.jan_26),
  (date '2026-02-01', items.feb_26),
  (date '2026-03-01', items.mar_26),
  (date '2026-04-01', items.apr_26),
  (date '2026-05-01', items.may_26),
  (date '2026-06-01', items.jun_26),
  (date '2026-07-01', items.jul_26),
  (date '2026-08-01', items.aug_26),
  (date '2026-09-01', items.sep_26)
) as legacy(usage_month, quantity)
where nullif(btrim(legacy.quantity), '') is not null
  and public.parse_inventory_numeric(legacy.quantity) is not null
on conflict (inventory_item_id, usage_month) do nothing;

update public.inventory_items
set stock_2026_10_20_update = stock_2026_10_20_update;

create or replace function public.import_inventory_with_history(items jsonb, monthly_values jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  imported_count integer;
begin
  if not public.is_inventory_host() then
    raise exception 'Akses hanya tersedia untuk akun HOST.';
  end if;

  if items is null or jsonb_typeof(items) <> 'array' then
    raise exception 'Data impor harus berupa daftar material.';
  end if;
  if jsonb_array_length(items) < 1 or jsonb_array_length(items) > 10000 then
    raise exception 'Jumlah baris impor harus antara 1 dan 10.000.';
  end if;
  if monthly_values is null or jsonb_typeof(monthly_values) <> 'array' then
    raise exception 'Data pemakaian bulanan tidak valid.';
  end if;
  if jsonb_array_length(monthly_values) > 120000 then
    raise exception 'Jumlah histori pemakaian melebihi batas impor.';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(monthly_values) as usage_row(ppm text, usage_month text, quantity numeric)
    where usage_row.ppm is null
      or btrim(usage_row.ppm) = ''
      or usage_row.usage_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])-01$'
      or usage_row.quantity is null
  ) then
    raise exception 'Histori pemakaian harus memiliki PPM, bulan valid, dan jumlah angka.';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(monthly_values) as usage_row(ppm text)
    left join jsonb_to_recordset(items) as item_row(ppm text) using (ppm)
    where item_row.ppm is null
  ) then
    raise exception 'Setiap baris histori harus mengacu pada PPM yang ikut diimpor.';
  end if;
  if exists (
    select btrim(usage_row.ppm), usage_row.usage_month
    from jsonb_to_recordset(monthly_values) as usage_row(ppm text, usage_month text)
    group by btrim(usage_row.ppm), usage_row.usage_month
    having count(*) > 1
  ) then
    raise exception 'Histori pemakaian memiliki PPM dan bulan yang sama lebih dari sekali.';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(items) as item_row(ppm text)
    where nullif(btrim(item_row.ppm), '') is null
  ) then
    raise exception 'PPM wajib diisi pada semua baris impor.';
  end if;
  if exists (
    select btrim(item_row.ppm)
    from jsonb_to_recordset(items) as item_row(ppm text)
    group by btrim(item_row.ppm)
    having count(*) > 1
  ) then
    raise exception 'PPM tidak boleh duplikat dalam file impor.';
  end if;

  with imported as (
    insert into public.inventory_items (
      ppm, material_description, part_category, sub_category,
      average, average_daily, lead_time_full, cycle_stock, service_factor,
      lead_time_factor, safety_stock, lead_time, max_stock, price, max_value,
      stock_2026_10_20_update, rop_minstock, roq_order, qty_order,
      purchase_requisition, purchase_order, durasi_stock_bulan,
      durasi_roq_bulan, minimum_order_quantity
    )
    select
      btrim(row_data.ppm), coalesce(row_data.material_description, ''),
      coalesce(row_data.part_category, ''), coalesce(row_data.sub_category, ''),
      coalesce(row_data.average, ''), coalesce(row_data.average_daily, ''),
      coalesce(row_data.lead_time_full, ''), coalesce(row_data.cycle_stock, ''),
      coalesce(row_data.service_factor, ''), coalesce(row_data.lead_time_factor, ''),
      coalesce(row_data.safety_stock, ''), coalesce(row_data.lead_time, ''),
      coalesce(row_data.max_stock, ''), coalesce(row_data.price, ''),
      coalesce(row_data.max_value, ''), coalesce(row_data.stock_2026_10_20_update, ''),
      coalesce(row_data.rop_minstock, ''), coalesce(row_data.roq_order, ''),
      coalesce(row_data.qty_order, ''), coalesce(row_data.purchase_requisition, ''),
      coalesce(row_data.purchase_order, ''), coalesce(row_data.durasi_stock_bulan, ''),
      coalesce(row_data.durasi_roq_bulan, ''), coalesce(row_data.minimum_order_quantity, '')
    from jsonb_to_recordset(items) as row_data (
      ppm text, material_description text, part_category text, sub_category text,
      average text, average_daily text, lead_time_full text, cycle_stock text,
      service_factor text, lead_time_factor text, safety_stock text, lead_time text,
      max_stock text, price text, max_value text, stock_2026_10_20_update text,
      rop_minstock text, roq_order text, qty_order text, purchase_requisition text,
      purchase_order text, durasi_stock_bulan text, durasi_roq_bulan text,
      minimum_order_quantity text
    )
    on conflict (ppm) do update set
      material_description = excluded.material_description,
      part_category = excluded.part_category,
      sub_category = excluded.sub_category,
      average = excluded.average,
      average_daily = excluded.average_daily,
      lead_time_full = excluded.lead_time_full,
      cycle_stock = excluded.cycle_stock,
      service_factor = excluded.service_factor,
      lead_time_factor = excluded.lead_time_factor,
      safety_stock = excluded.safety_stock,
      lead_time = excluded.lead_time,
      max_stock = excluded.max_stock,
      price = excluded.price,
      max_value = excluded.max_value,
      stock_2026_10_20_update = excluded.stock_2026_10_20_update,
      rop_minstock = excluded.rop_minstock,
      roq_order = excluded.roq_order,
      qty_order = excluded.qty_order,
      purchase_requisition = excluded.purchase_requisition,
      purchase_order = excluded.purchase_order,
      durasi_stock_bulan = excluded.durasi_stock_bulan,
      durasi_roq_bulan = excluded.durasi_roq_bulan,
      minimum_order_quantity = excluded.minimum_order_quantity,
      updated_at = now()
    returning id, ppm
  ), incoming_usage as (
    select imported.id, usage_row.usage_month::date as usage_month, usage_row.quantity
    from jsonb_to_recordset(monthly_values) as usage_row(ppm text, usage_month text, quantity numeric)
    join imported on imported.ppm = usage_row.ppm
  )
  insert into public.inventory_monthly_usage (inventory_item_id, usage_month, quantity)
  select id, usage_month, quantity
  from incoming_usage
  on conflict (inventory_item_id, usage_month) do update
    set quantity = excluded.quantity;

  imported_count := jsonb_array_length(items);
  return imported_count;
end;
$$;

create or replace function public.save_inventory_item_with_history(
  item_data jsonb,
  history jsonb,
  deleted_months jsonb,
  inventory_item_id bigint
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_item_id bigint;
  ppm_value text;
begin
  if not public.is_inventory_host() then
    raise exception 'Akses hanya tersedia untuk akun HOST.';
  end if;
  if item_data is null or jsonb_typeof(item_data) <> 'object' then
    raise exception 'Data material tidak valid.';
  end if;
  if history is null or jsonb_typeof(history) <> 'array' or jsonb_array_length(history) > 1200 then
    raise exception 'Histori pemakaian tidak valid.';
  end if;
  if deleted_months is null or jsonb_typeof(deleted_months) <> 'array' or jsonb_array_length(deleted_months) > 1200 then
    raise exception 'Daftar histori yang dihapus tidak valid.';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(history) as history_row(usage_month text, quantity numeric)
    where history_row.usage_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])-01$'
      or history_row.quantity is null
  ) or exists (
    select 1
    from jsonb_array_elements_text(deleted_months) as month_value(value)
    where month_value.value !~ '^[0-9]{4}-(0[1-9]|1[0-2])-01$'
  ) then
    raise exception 'Bulan harus valid dan jumlah pemakaian harus berupa angka.';
  end if;
  if exists (
    select history_row.usage_month
    from jsonb_to_recordset(history) as history_row(usage_month text)
    group by history_row.usage_month
    having count(*) > 1
  ) then
    raise exception 'Setiap bulan hanya boleh dicantumkan satu kali.';
  end if;

  ppm_value := btrim(coalesce(item_data ->> 'ppm', ''));
  if ppm_value = '' then
    raise exception 'PPM wajib diisi.';
  end if;

  if inventory_item_id is null then
    insert into public.inventory_items (
      ppm, material_description, part_category, sub_category, average, average_daily,
      lead_time_full, cycle_stock, service_factor, lead_time_factor, safety_stock,
      lead_time, max_stock, price, max_value, stock_2026_10_20_update, rop_minstock,
      roq_order, qty_order, purchase_requisition, purchase_order, durasi_stock_bulan,
      durasi_roq_bulan, minimum_order_quantity
    )
    values (
      ppm_value, coalesce(item_data ->> 'material_description', ''),
      coalesce(item_data ->> 'part_category', ''), coalesce(item_data ->> 'sub_category', ''),
      coalesce(item_data ->> 'average', ''), coalesce(item_data ->> 'average_daily', ''),
      coalesce(item_data ->> 'lead_time_full', ''), coalesce(item_data ->> 'cycle_stock', ''),
      coalesce(item_data ->> 'service_factor', ''), coalesce(item_data ->> 'lead_time_factor', ''),
      coalesce(item_data ->> 'safety_stock', ''), coalesce(item_data ->> 'lead_time', ''),
      coalesce(item_data ->> 'max_stock', ''), coalesce(item_data ->> 'price', ''),
      coalesce(item_data ->> 'max_value', ''), coalesce(item_data ->> 'stock_2026_10_20_update', ''),
      coalesce(item_data ->> 'rop_minstock', ''), coalesce(item_data ->> 'roq_order', ''),
      coalesce(item_data ->> 'qty_order', ''), coalesce(item_data ->> 'purchase_requisition', ''),
      coalesce(item_data ->> 'purchase_order', ''), coalesce(item_data ->> 'durasi_stock_bulan', ''),
      coalesce(item_data ->> 'durasi_roq_bulan', ''), coalesce(item_data ->> 'minimum_order_quantity', '')
    )
    returning id into saved_item_id;
  else
    update public.inventory_items
    set ppm = ppm_value,
        material_description = coalesce(item_data ->> 'material_description', ''),
        part_category = coalesce(item_data ->> 'part_category', ''),
        sub_category = coalesce(item_data ->> 'sub_category', ''),
        average = coalesce(item_data ->> 'average', ''),
        average_daily = coalesce(item_data ->> 'average_daily', ''),
        lead_time_full = coalesce(item_data ->> 'lead_time_full', ''),
        cycle_stock = coalesce(item_data ->> 'cycle_stock', ''),
        service_factor = coalesce(item_data ->> 'service_factor', ''),
        lead_time_factor = coalesce(item_data ->> 'lead_time_factor', ''),
        safety_stock = coalesce(item_data ->> 'safety_stock', ''),
        lead_time = coalesce(item_data ->> 'lead_time', ''),
        max_stock = coalesce(item_data ->> 'max_stock', ''),
        price = coalesce(item_data ->> 'price', ''),
        max_value = coalesce(item_data ->> 'max_value', ''),
        stock_2026_10_20_update = coalesce(item_data ->> 'stock_2026_10_20_update', ''),
        rop_minstock = coalesce(item_data ->> 'rop_minstock', ''),
        roq_order = coalesce(item_data ->> 'roq_order', ''),
        qty_order = coalesce(item_data ->> 'qty_order', ''),
        purchase_requisition = coalesce(item_data ->> 'purchase_requisition', ''),
        purchase_order = coalesce(item_data ->> 'purchase_order', ''),
        durasi_stock_bulan = coalesce(item_data ->> 'durasi_stock_bulan', ''),
        durasi_roq_bulan = coalesce(item_data ->> 'durasi_roq_bulan', ''),
        minimum_order_quantity = coalesce(item_data ->> 'minimum_order_quantity', ''),
        updated_at = now()
    where id = inventory_item_id
    returning id into saved_item_id;

    if saved_item_id is null then
      raise exception 'Material tidak ditemukan.';
    end if;
  end if;

  insert into public.inventory_monthly_usage (inventory_item_id, usage_month, quantity)
  select saved_item_id, history_row.usage_month::date, history_row.quantity
  from jsonb_to_recordset(history) as history_row(usage_month text, quantity numeric)
  on conflict (inventory_item_id, usage_month) do update
    set quantity = excluded.quantity;

  delete from public.inventory_monthly_usage
  where inventory_monthly_usage.inventory_item_id = saved_item_id
    and usage_month in (
      select month_value.value::date
      from jsonb_array_elements_text(deleted_months) as month_value(value)
    );

  return saved_item_id;
end;
$$;

revoke all on function public.import_inventory_with_history(jsonb, jsonb) from public, anon;
grant execute on function public.import_inventory_with_history(jsonb, jsonb) to authenticated;
revoke all on function public.save_inventory_item_with_history(jsonb, jsonb, jsonb, bigint) from public, anon;
grant execute on function public.save_inventory_item_with_history(jsonb, jsonb, jsonb, bigint) to authenticated;
