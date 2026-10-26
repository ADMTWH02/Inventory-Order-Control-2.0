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
  on conflict on constraint inventory_monthly_usage_pkey do update
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

revoke all on function public.save_inventory_item_with_history(jsonb, jsonb, jsonb, bigint) from public, anon;
grant execute on function public.save_inventory_item_with_history(jsonb, jsonb, jsonb, bigint) to authenticated;
