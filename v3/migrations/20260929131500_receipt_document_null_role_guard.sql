-- Harden receipt-document authorization against NULL/inactive profiles.
BEGIN;

CREATE OR REPLACE FUNCTION public.register_purchase_receipt_document(
  p_receipt_id uuid,
  p_kind text,
  p_file_path text,
  p_file_name text DEFAULT NULL::text,
  p_document_number text DEFAULT NULL::text,
  p_document_date date DEFAULT NULL::date
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_receipt public.purchase_receipts%rowtype;
  v_purchase public.purchases%rowtype;
  v_doc uuid;
  v_role text;
begin
  v_role:=public.current_profile_role();
  if coalesce(v_role in ('admin','depositor'),false) is not true then
    raise exception 'Usuario no autorizado para adjuntar documentos de recepción.';
  end if;
  if p_kind not in ('invoice','remittance','other') then raise exception 'Tipo de documento inválido.'; end if;
  if nullif(trim(coalesce(p_file_path,'')),'') is null then raise exception 'Falta el archivo del documento.'; end if;

  select * into v_receipt from public.purchase_receipts where id=p_receipt_id;
  if not found then raise exception 'Recepción inexistente.'; end if;
  select * into v_purchase from public.purchases where id=v_receipt.purchase_id;
  if not found then raise exception 'Compra inexistente.'; end if;
  if v_role='depositor' then perform public.assert_can_access_warehouse(v_receipt.warehouse_id); end if;

  insert into public.purchase_documents(purchase_id,receipt_id,kind,file_path,file_name,document_number,document_date,source,uploaded_by)
  values(v_purchase.id,v_receipt.id,p_kind,p_file_path,p_file_name,p_document_number,p_document_date,'receipt',auth.uid())
  returning id into v_doc;

  if p_kind='invoice' then
    update public.purchases
       set invoice_number=coalesce(nullif(trim(p_document_number),''),invoice_number),
           invoice_date=coalesce(p_document_date,invoice_date),
           updated_at=now()
     where id=v_purchase.id;
  end if;

  insert into public.audit_events(entity_type,entity_id,purchase_id,action,actor_id,detail)
  values('purchase',v_purchase.id,v_purchase.id,'purchase_receipt_document_attached',auth.uid(),
    jsonb_build_object('receipt_id',v_receipt.id,'kind',p_kind,'document_number',p_document_number,'file_name',p_file_name));
  return v_doc;
end
$function$;

COMMIT;
