-- Allow incomplete catalog details in the review; final save and issue still validate the issuer.
begin;
create or replace function avh_commercial_private.review_company(p jsonb)
returns jsonb language plpgsql stable set search_path='' as $$
declare c public.purchase_companies;v jsonb;k text;
begin
 select * into c from public.purchase_companies where id=nullif(p->>'id','')::uuid and active;
 if c.id is null then raise exception 'Elegí una empresa emisora activa.';end if;
 v:=jsonb_build_object('id',c.id,'name',c.name,'brand_avh',c.name='AVH' or coalesce(c.legal_name,c.name) ilike '%Villa Hayes%');
 foreach k in array array['legal_name','tax_id','address','phone','email'] loop
  if length(coalesce(p->>k,''))>500 then raise exception 'Campo de empresa demasiado extenso: %.',k;end if;
  v:=v||jsonb_build_object(k,trim(coalesce(p->>k,'')));
 end loop;
 return v;
end $$;

commit;
