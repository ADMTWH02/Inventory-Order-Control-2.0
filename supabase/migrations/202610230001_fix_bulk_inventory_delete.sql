create or replace function public.delete_all_inventory()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_count bigint;
begin
  if not public.is_inventory_host() then
    raise exception 'Akses hanya tersedia untuk akun HOST.';
  end if;

  delete from public.inventory_items where id is not null;
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.delete_all_inventory() from public, anon;
grant execute on function public.delete_all_inventory() to authenticated;
