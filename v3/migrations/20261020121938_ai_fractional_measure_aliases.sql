create or replace function avh_purchase_private.product_identity(p_description text,p_brand text default null,p_model text default null)
returns jsonb language plpgsql stable security invoker set search_path='' as $fn$
declare
 v text:=lower(replace(replace(replace(coalesce(p_description,''),',','.'),'½',' 1/2'),'″','"'));
 b text:=nullif(lower(trim(p_brand)),'');m text[];u text;vals numeric[];sizes jsonb:='{}';
begin
 for m in select regexp_matches(v,'([0-9]+)[.[:space:]-]+([123])\s*/\s*([24])','g') loop
  v:=regexp_replace(v,m[1]||'[.[:space:]-]+'||m[2]||'\s*/\s*'||m[3],(m[1]::numeric+m[2]::numeric/m[3]::numeric)::text,'g');
 end loop;
 if b is null then
  select candidate into b from (
   select unnest(array['maxflexx','norton','tyrolit','wst','esab','hyundai','lincoln','thor','atlantic','conarco','bosch','makita','dewalt','stanley','3m','gastec','elcometer','graco','sata','weg','tramontina','starrett','bahco','irwin','miller','kemppi','fronius']) candidate
   union select lower(trim(brand)) from public.products where brand is not null and trim(brand)<>''
  ) brands where strpos(' '||regexp_replace(v,'[^a-z0-9]+',' ','g')||' ',' '||regexp_replace(candidate,'[^a-z0-9]+',' ','g')||' ')>0 order by length(candidate) desc limit 1;
 end if;
 if b is null then b:=(regexp_match(v,'\mmarca\s+([a-z][a-z0-9-]+)'))[1];end if;
 foreach u in array array['mm','inch','kg'] loop
  vals:=array[]::numeric[];
  for m in select regexp_matches(v,'([0-9]+(?:\.[0-9]+)?(?:\s*[x×]\s*[0-9]+(?:\.[0-9]+)?)*)\s*'||case u when 'mm' then 'mm\M' when 'kg' then 'kg\M' else '(?:"|pulgadas?\M|pulg\M|inch\M)' end,'g') loop
   vals:=vals||regexp_split_to_array(m[1],'\s*[x×]\s*')::numeric[];
  end loop;
  select coalesce(array_agg(distinct n order by n),array[]::numeric[]) into vals from unnest(vals) n;
  sizes:=sizes||jsonb_build_object(u,to_jsonb(vals));
 end loop;
 return jsonb_build_object('brand',b,'model',nullif(lower(regexp_replace(coalesce(p_model,(regexp_match(v,'\m(mca[-\s]*[0-9]+[a-z0-9-]*)\M'))[1],''),'[^a-zA-Z0-9]','','g')),''),'sizes',sizes,
  'family',case when v~'\mdisco\M' and v~'\mdesbaste\M' then 'desbaste' when v~'\mdisco\M' and v~'\mcorte\M' then 'corte' else null end,
  'classification',(regexp_match(regexp_replace(v,'[^a-z0-9]','','g'),'(e71t1c?|er70s6|em12k)'))[1]);
end $fn$;


revoke all on function avh_purchase_private.product_identity(text,text,text) from public,anon,authenticated;
