-- Issuer details belong to each quote; they never modify the purchasing company catalog.
begin;
create or replace function avh_commercial_private.quote_company(p jsonb,p_complete boolean default false)
returns jsonb language plpgsql stable set search_path='' as $$
declare c jsonb;v jsonb;k text;logo text;data bytea;mime text;size integer;pos integer;marker integer;segment integer;w bigint:=0;h bigint:=0;
begin
 if auth.uid() is null or avh_commercial_private.role() is null then raise exception 'No autorizado para presupuestos.';end if;
 if p is not null and jsonb_typeof(p) is distinct from 'object' then raise exception 'Empresa emisora inválida.';end if;
 if p->'brand_avh' is distinct from 'false'::jsonb then
  c:=avh_commercial_private.company();
  if c is null then raise exception 'Empresa emisora no configurada.';end if;
  v:=c||jsonb_build_object('brand_avh',true);
  if p->'brand_avh' is distinct from 'true'::jsonb then return v;end if;
 else v:=jsonb_build_object('brand_avh',false);end if;
 foreach k in array array['legal_name','tax_id','address','phone','email'] loop
  if p ? k and p->k<>'null'::jsonb and jsonb_typeof(p->k) is distinct from 'string' then raise exception 'Campo de empresa inválido: %.',k;end if;
  if length(coalesce(p->>k,''))>500 then raise exception 'Campo de empresa demasiado extenso: %.',k;end if;
  v:=v||jsonb_build_object(k,trim(coalesce(p->>k,v->>k,'')));
 end loop;
 v:=v||jsonb_build_object('name',v->>'legal_name');
 if v->'brand_avh'='false'::jsonb then
  if p ? 'logo_data_url' and jsonb_typeof(p->'logo_data_url') is distinct from 'string' then raise exception 'Logo inválido.';end if;
  logo:=coalesce(p->>'logo_data_url','');
  if logo<>'' then
   if length(logo)>409630 or logo!~'^data:image/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$' then raise exception 'El logo debe ser PNG o JPG de hasta 300 KB.';end if;
   mime:=split_part(split_part(logo,';',1),':',2);data:=decode(split_part(logo,',',2),'base64');size:=octet_length(data);
   if size>307200 or size<12 then raise exception 'Tamaño de logo inválido (hasta 300 KB).';end if;
   if mime='image/png' then
    if size<45 or substring(data from 1 for 16)<>decode('89504e470d0a1a0a0000000d49484452','hex') or substring(data from size-11 for 12)<>decode('0000000049454e44ae426082','hex') then raise exception 'El logo PNG no es válido.';end if;
    w:=get_byte(data,16)::bigint*16777216+get_byte(data,17)*65536+get_byte(data,18)*256+get_byte(data,19);
    h:=get_byte(data,20)::bigint*16777216+get_byte(data,21)*65536+get_byte(data,22)*256+get_byte(data,23);
   else
    if substring(data from 1 for 2)<>decode('ffd8','hex') or substring(data from size-1 for 2)<>decode('ffd9','hex') then raise exception 'El logo JPG no es válido.';end if;
    pos:=2;
    while pos+3<size loop
     if get_byte(data,pos)<>255 then raise exception 'El logo JPG no es válido.';end if;pos:=pos+1;
     while pos<size and get_byte(data,pos)=255 loop pos:=pos+1;end loop;
     if pos+2>=size then exit;end if;marker:=get_byte(data,pos);pos:=pos+1;
     if marker in (217,218) then exit;end if;
     if marker=1 or marker between 208 and 215 then continue;end if;
     segment:=get_byte(data,pos)*256+get_byte(data,pos+1);
     if segment<2 or pos+segment>size then raise exception 'El logo JPG está incompleto.';end if;
     if marker in (192,193,194,195,197,198,199,201,202,203,205,206,207) then
      if segment<8 then exit;end if;h:=get_byte(data,pos+3)*256+get_byte(data,pos+4);w:=get_byte(data,pos+5)*256+get_byte(data,pos+6);exit;
     end if;pos:=pos+segment;
    end loop;
   end if;
   if w<1 or h<1 or w>2048 or h>2048 or w*h>2097152 then raise exception 'El logo admite hasta 2.048 píxeles por lado y 2 megapíxeles.';end if;
  end if;
  v:=v||jsonb_build_object('logo_data_url',logo);
 end if;
 -- A palette is part of this quote's issuer snapshot, including the immutable issued copy.
 if p ? 'brand_color' and p->'brand_color'<>'null'::jsonb then
  if jsonb_typeof(p->'brand_color') is distinct from 'string' or (p->>'brand_color')!~'^#[0-9A-Fa-f]{6}$' then raise exception 'Color del presupuesto inválido. Elegí un color hexadecimal de seis dígitos.';end if;
  v:=v||jsonb_build_object('brand_color',lower(p->>'brand_color'));
 end if;
 if p ? 'brand_color_mode' and p->'brand_color_mode'<>'null'::jsonb and (jsonb_typeof(p->'brand_color_mode') is distinct from 'string' or p->>'brand_color_mode' not in ('auto','manual')) then raise exception 'Modo de color inválido.';end if;
 v:=v||jsonb_build_object('brand_color_mode',coalesce(p->>'brand_color_mode','auto'));
 if v->>'brand_color_mode'='manual' and not (v ? 'brand_color') then raise exception 'Elegí el color del presupuesto.';end if;
 if p_complete and (coalesce(v->>'legal_name','')='' or coalesce(v->>'tax_id','')='') then raise exception 'Completá razón social y RUC de la empresa emisora.';end if;
 return v;
end $$;
revoke all on function avh_commercial_private.quote_company(jsonb,boolean) from public,anon,authenticated;

commit;
