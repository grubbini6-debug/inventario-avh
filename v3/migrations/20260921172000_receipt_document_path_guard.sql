-- AVH V3 — hardening de documentos de recepción.
-- Evita que un usuario autenticado vincule a su compra un archivo perteneciente
-- a otra compra y luego lo procese mediante funciones privilegiadas/IA.
-- No cambia el flujo de negocio: los documentos de recepción siguen guardándose
-- en purchase-documents/<purchase_id>/receipts/.

create or replace function public.register_purchase_receipt_document(
  p_receipt_id uuid,
  p_kind text,
  p_file_path text,
  p_file_name text default null::text,
  p_document_number text default null::text,
  p_document_date date default null::date
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_receipt public.purchase_receipts%rowtype;
  v_purchase public.purchases%rowtype;
  v_doc uuid;
  v_role text;
  v_expected_prefix text;
begin
  v_role:=public.current_profile_role();
  if v_role not in ('admin','depositor') then
    raise exception 'Usuario no autorizado para adjuntar documentos de recepción.';
  end if;
  if p_kind not in ('invoice','remittance','other') then
    raise exception 'Tipo de documento inválido.';
  end if;
  if nullif(trim(coalesce(p_file_path,'')),'') is null then
    raise exception 'Falta el archivo del documento.';
  end if;

  select * into v_receipt
  from public.purchase_receipts
  where id=p_receipt_id;
  if not found then raise exception 'Recepción inexistente.'; end if;

  select * into v_purchase
  from public.purchases
  where id=v_receipt.purchase_id;
  if not found then raise exception 'Compra inexistente.'; end if;

  if v_role='depositor' then
    perform public.assert_can_access_warehouse(v_receipt.warehouse_id);
  end if;

  v_expected_prefix:=v_purchase.id::text||'/receipts/';
  if left(p_file_path,length(v_expected_prefix))<>v_expected_prefix then
    raise exception 'El archivo no pertenece al expediente de esta compra.';
  end if;

  if not exists(
    select 1
    from storage.objects o
    where o.bucket_id='purchase-documents'
      and o.name=p_file_path
  ) then
    raise exception 'El archivo indicado no existe en el almacenamiento de compras.';
  end if;

  insert into public.purchase_documents(
    purchase_id,receipt_id,kind,file_path,file_name,
    document_number,document_date,source,uploaded_by
  )
  values(
    v_purchase.id,v_receipt.id,p_kind,p_file_path,p_file_name,
    p_document_number,p_document_date,'receipt',auth.uid()
  )
  returning id into v_doc;

  if p_kind='invoice' then
    update public.purchases
       set invoice_number=coalesce(nullif(trim(p_document_number),''),invoice_number),
           invoice_date=coalesce(p_document_date,invoice_date),
           updated_at=now()
     where id=v_purchase.id;
  end if;

  insert into public.audit_events(
    entity_type,entity_id,purchase_id,action,actor_id,detail
  )
  values(
    'purchase',v_purchase.id,v_purchase.id,
    'purchase_receipt_document_attached',auth.uid(),
    jsonb_build_object(
      'receipt_id',v_receipt.id,
      'kind',p_kind,
      'document_number',p_document_number,
      'file_name',p_file_name
    )
  );
  return v_doc;
end
$function$;
