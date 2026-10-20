-- This private trigger needs owner access only to read the identity catalog; it cannot write data.
create or replace function avh_purchase_private.guard_purchase_identity()
returns trigger language plpgsql security definer set search_path='' as $fn$
declare problem text;
begin
 if NEW.product_id is not null then
  problem:=avh_purchase_private.product_identity_problem(NEW.description,null,null,NEW.product_id);
  if problem is not null then raise exception '%',problem;end if;
 end if;
 return NEW;
end $fn$;
revoke all on function avh_purchase_private.product_identity(text,text,text) from public,anon,authenticated;
revoke all on function avh_purchase_private.product_identity_problem(text,text,text,uuid) from public,anon,authenticated;
revoke all on function avh_purchase_private.guard_purchase_identity() from public,anon,authenticated;
drop trigger if exists purchase_items_identity_guard on public.purchase_items;
create trigger purchase_items_identity_guard before insert or update of product_id,description on public.purchase_items for each row execute function avh_purchase_private.guard_purchase_identity();

-- Backfill only brands already written in the catalog name; never infer an unknown brand.
update public.products p set brand=avh_purchase_private.product_identity(p.name)->>'brand' where p.brand is null and avh_purchase_private.product_identity(p.name)->>'brand' is not null;

