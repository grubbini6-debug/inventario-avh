-- Centro de calidad de datos AVH: inconsistencias objetivas y completitud operativa.
create or replace view public.v_data_quality_issues
with (security_invoker = true)
as
WITH purchase_history_products AS (
         SELECT DISTINCT pi.product_id
           FROM purchase_items pi
             JOIN purchases p ON p.id = pi.purchase_id
          WHERE p.status <> 'cancelled'::text AND pi.product_id IS NOT NULL
        ), recent_consumed_products AS (
         SELECT DISTINCT ml.product_id
           FROM movements m
             JOIN movement_lines ml ON ml.movement_id = m.id
          WHERE m.type = 'exit'::text AND m.status = 'confirmed'::text AND m.created_at >= (now() - '90 days'::interval)
        ), duplicate_names AS (
         SELECT lower(regexp_replace(TRIM(BOTH FROM products.name), '\s+'::text, ' '::text, 'g'::text)) AS norm_name,
            count(*)::integer AS duplicate_count,
            string_agg(products.name || COALESCE(' · SKU '::text || NULLIF(products.sku, ''::text), ''::text), ' / '::text ORDER BY products.name) AS names
           FROM products
          WHERE products.active = true
          GROUP BY (lower(regexp_replace(TRIM(BOTH FROM products.name), '\s+'::text, ' '::text, 'g'::text)))
         HAVING count(*) > 1
        ), used_suppliers AS (
         SELECT DISTINCT s.id,
            s.name,
            s.tax_id,
            s.phone
           FROM suppliers s
             JOIN purchases p ON p.supplier_id = s.id
          WHERE p.status <> 'cancelled'::text
        )
 SELECT 'purchase_no_supplier:'::text || p.id::text AS issue_key,
    'critical'::text AS severity,
    'compras'::text AS domain,
    'purchase_no_supplier'::text AS issue_code,
    'purchase'::text AS entity_type,
    p.id::text AS entity_id,
    NULL::uuid AS product_id,
    p.id AS purchase_id,
    p.warehouse_id,
    NULL::uuid AS supplier_id,
    'Compra sin proveedor'::text AS title,
    (COALESCE(p.po_number, p.order_reference, 'Compra sin referencia'::text) || ' · estado '::text) || p.status AS detail
   FROM purchases p
  WHERE (p.status = ANY (ARRAY['approved'::text, 'ordered'::text, 'in_transit'::text, 'partially_received'::text, 'received'::text, 'invoiced'::text, 'closed'::text])) AND p.supplier_id IS NULL
UNION ALL
 SELECT 'purchase_no_expected_date:'::text || p.id::text AS issue_key,
    'warning'::text AS severity,
    'compras'::text AS domain,
    'purchase_no_expected_date'::text AS issue_code,
    'purchase'::text AS entity_type,
    p.id::text AS entity_id,
    NULL::uuid AS product_id,
    p.id AS purchase_id,
    p.warehouse_id,
    p.supplier_id,
    'Compra sin fecha prometida'::text AS title,
    (COALESCE(p.po_number, p.order_reference, 'Compra sin referencia'::text) || ' · '::text) || COALESCE(s.name, 'Sin proveedor'::text) AS detail
   FROM purchases p
     LEFT JOIN suppliers s ON s.id = p.supplier_id
  WHERE p.destination_type = 'warehouse'::text AND (p.status = ANY (ARRAY['ordered'::text, 'in_transit'::text, 'partially_received'::text])) AND p.expected_date IS NULL
UNION ALL
 SELECT 'purchase_no_warehouse:'::text || p.id::text AS issue_key,
    'critical'::text AS severity,
    'compras'::text AS domain,
    'purchase_no_warehouse'::text AS issue_code,
    'purchase'::text AS entity_type,
    p.id::text AS entity_id,
    NULL::uuid AS product_id,
    p.id AS purchase_id,
    NULL::uuid AS warehouse_id,
    p.supplier_id,
    'Compra para depósito sin depósito asignado'::text AS title,
    (COALESCE(p.po_number, p.order_reference, 'Compra sin referencia'::text) || ' · '::text) || COALESCE(s.name, 'Sin proveedor'::text) AS detail
   FROM purchases p
     LEFT JOIN suppliers s ON s.id = p.supplier_id
  WHERE p.destination_type = 'warehouse'::text AND p.status <> 'cancelled'::text AND p.warehouse_id IS NULL
UNION ALL
 SELECT 'purchase_no_barge:'::text || p.id::text AS issue_key,
    'critical'::text AS severity,
    'compras'::text AS domain,
    'purchase_no_barge'::text AS issue_code,
    'purchase'::text AS entity_type,
    p.id::text AS entity_id,
    NULL::uuid AS product_id,
    p.id AS purchase_id,
    NULL::uuid AS warehouse_id,
    p.supplier_id,
    'Compra para barcaza sin barcaza asignada'::text AS title,
    (COALESCE(p.po_number, p.order_reference, 'Compra sin referencia'::text) || ' · '::text) || COALESCE(s.name, 'Sin proveedor'::text) AS detail
   FROM purchases p
     LEFT JOIN suppliers s ON s.id = p.supplier_id
  WHERE p.destination_type = 'barge'::text AND p.status <> 'cancelled'::text AND p.barge_id IS NULL
UNION ALL
 SELECT 'inventory_item_no_product:'::text || pi.id::text AS issue_key,
    'critical'::text AS severity,
    'compras'::text AS domain,
    'inventory_item_no_product'::text AS issue_code,
    'purchase_item'::text AS entity_type,
    pi.id::text AS entity_id,
    NULL::uuid AS product_id,
    p.id AS purchase_id,
    p.warehouse_id,
    p.supplier_id,
    'Ítem que entra a stock sin producto vinculado'::text AS title,
    (pi.description || ' · '::text) || COALESCE(p.po_number, p.order_reference, 'Compra sin referencia'::text) AS detail
   FROM purchase_items pi
     JOIN purchases p ON p.id = pi.purchase_id
  WHERE p.status <> 'cancelled'::text AND pi.affects_inventory = true AND pi.product_id IS NULL
UNION ALL
 SELECT 'over_received:'::text || pi.id::text AS issue_key,
    'critical'::text AS severity,
    'compras'::text AS domain,
    'over_received'::text AS issue_code,
    'purchase_item'::text AS entity_type,
    pi.id::text AS entity_id,
    pi.product_id,
    p.id AS purchase_id,
    p.warehouse_id,
    p.supplier_id,
    'Cantidad recibida mayor a la comprada'::text AS title,
    (((pi.description || ' · comprado '::text) || pi.quantity::text) || ' · recibido '::text) || pi.received_qty::text AS detail
   FROM purchase_items pi
     JOIN purchases p ON p.id = pi.purchase_id
  WHERE p.status <> 'cancelled'::text AND pi.received_qty > (pi.quantity + 0.000001)
UNION ALL
 SELECT 'stale_purchase:'::text || p.id::text AS issue_key,
    'warning'::text AS severity,
    'compras'::text AS domain,
    'stale_purchase'::text AS issue_code,
    'purchase'::text AS entity_type,
    p.id::text AS entity_id,
    NULL::uuid AS product_id,
    p.id AS purchase_id,
    p.warehouse_id,
    p.supplier_id,
    'Compra abierta hace más de 30 días'::text AS title,
    (((COALESCE(p.po_number, p.order_reference, 'Compra sin referencia'::text) || ' · pedida '::text) || p.ordered_date::text) || ' · '::text) || COALESCE(s.name, 'Sin proveedor'::text) AS detail
   FROM purchases p
     LEFT JOIN suppliers s ON s.id = p.supplier_id
  WHERE (p.status = ANY (ARRAY['ordered'::text, 'in_transit'::text, 'partially_received'::text])) AND p.ordered_date < (CURRENT_DATE - 30)
UNION ALL
 SELECT (('missing_minimum:'::text || a.warehouse_id::text) || ':'::text) || a.product_id::text AS issue_key,
    'warning'::text AS severity,
    'inventario'::text AS domain,
    'missing_minimum'::text AS issue_code,
    'product'::text AS entity_type,
    a.product_id::text AS entity_id,
    a.product_id,
    NULL::uuid AS purchase_id,
    a.warehouse_id,
    NULL::uuid AS supplier_id,
    'Producto activo sin mínimo configurado'::text AS title,
    (((((a.product_name || ' · '::text) || a.warehouse_name) || ' · stock '::text) || a.stock_qty::text) || ' '::text) || a.base_unit AS detail
   FROM v_smart_stock_alerts a
     JOIN products p ON p.id = a.product_id AND p.active = true
  WHERE a.minimum_qty IS NULL AND (a.stock_qty > 0::numeric OR a.avg_daily_30d > 0::numeric OR a.inbound_qty > 0::numeric)
UNION ALL
 SELECT 'consumption_no_price:'::text || p.id::text AS issue_key,
    'warning'::text AS severity,
    'inventario'::text AS domain,
    'consumption_no_price'::text AS issue_code,
    'product'::text AS entity_type,
    p.id::text AS entity_id,
    p.id AS product_id,
    NULL::uuid AS purchase_id,
    NULL::uuid AS warehouse_id,
    NULL::uuid AS supplier_id,
    'Producto con consumo sin historial de compra'::text AS title,
    p.name || ' · tuvo salidas en los últimos 90 días y no tiene compra vinculada'::text AS detail
   FROM products p
     JOIN recent_consumed_products rc ON rc.product_id = p.id
     LEFT JOIN purchase_history_products ph ON ph.product_id = p.id
  WHERE p.active = true AND ph.product_id IS NULL
UNION ALL
 SELECT 'batch_no_cost:'::text || ib.id::text AS issue_key,
    'warning'::text AS severity,
    'inventario'::text AS domain,
    'batch_no_cost'::text AS issue_code,
    'batch'::text AS entity_type,
    ib.id::text AS entity_id,
    ib.product_id,
    NULL::uuid AS purchase_id,
    ib.warehouse_id,
    NULL::uuid AS supplier_id,
    'Stock disponible sin costo'::text AS title,
    (((((p.name || ' · '::text) || w.name) || ' · '::text) || ib.quantity_remaining::text) || ' '::text) || p.base_unit AS detail
   FROM inventory_batches ib
     JOIN products p ON p.id = ib.product_id
     JOIN warehouses w ON w.id = ib.warehouse_id
  WHERE ib.quantity_remaining > 0::numeric AND ib.unit_cost IS NULL
UNION ALL
 SELECT 'duplicate_product:'::text || dn.norm_name AS issue_key,
    'warning'::text AS severity,
    'catalogo'::text AS domain,
    'duplicate_product'::text AS issue_code,
    'product_group'::text AS entity_type,
    dn.norm_name AS entity_id,
    NULL::uuid AS product_id,
    NULL::uuid AS purchase_id,
    NULL::uuid AS warehouse_id,
    NULL::uuid AS supplier_id,
    'Posible producto duplicado'::text AS title,
    ((dn.names || ' · '::text) || dn.duplicate_count::text) || ' registros activos'::text AS detail
   FROM duplicate_names dn
UNION ALL
 SELECT 'product_no_sku:'::text || p.id::text AS issue_key,
    'info'::text AS severity,
    'catalogo'::text AS domain,
    'product_no_sku'::text AS issue_code,
    'product'::text AS entity_type,
    p.id::text AS entity_id,
    p.id AS product_id,
    NULL::uuid AS purchase_id,
    NULL::uuid AS warehouse_id,
    NULL::uuid AS supplier_id,
    'Producto activo sin SKU'::text AS title,
    (p.name || ' · unidad base '::text) || p.base_unit AS detail
   FROM products p
  WHERE p.active = true AND NULLIF(TRIM(BOTH FROM COALESCE(p.sku, ''::text)), ''::text) IS NULL
UNION ALL
 SELECT 'supplier_incomplete:'::text || s.id::text AS issue_key,
    'info'::text AS severity,
    'proveedores'::text AS domain,
    'supplier_incomplete'::text AS issue_code,
    'supplier'::text AS entity_type,
    s.id::text AS entity_id,
    NULL::uuid AS product_id,
    NULL::uuid AS purchase_id,
    NULL::uuid AS warehouse_id,
    s.id AS supplier_id,
    'Ficha de proveedor incompleta'::text AS title,
    (s.name || ' · falta '::text) || concat_ws(' y '::text,
        CASE
            WHEN NULLIF(TRIM(BOTH FROM COALESCE(s.tax_id, ''::text)), ''::text) IS NULL THEN 'RUC'::text
            ELSE NULL::text
        END,
        CASE
            WHEN NULLIF(TRIM(BOTH FROM COALESCE(s.phone, ''::text)), ''::text) IS NULL THEN 'teléfono'::text
            ELSE NULL::text
        END) AS detail
   FROM used_suppliers s
  WHERE NULLIF(TRIM(BOTH FROM COALESCE(s.tax_id, ''::text)), ''::text) IS NULL OR NULLIF(TRIM(BOTH FROM COALESCE(s.phone, ''::text)), ''::text) IS NULL;

grant select on public.v_data_quality_issues to authenticated;
revoke all on public.v_data_quality_issues from anon;
