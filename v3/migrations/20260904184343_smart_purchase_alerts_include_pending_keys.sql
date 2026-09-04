-- Incluye productos con stock, consumo o compras pendientes aunque no tengan mínimo.
create or replace view public.v_smart_stock_alerts
with (security_invoker = true)
as
WITH usage30 AS (
         SELECT m.warehouse_from_id AS warehouse_id,
            ml.product_id,
            sum(ml.base_quantity) AS qty_30d,
            count(DISTINCT m.id) AS exit_count_30d,
            max(m.created_at) AS last_exit_at
           FROM movements m
             JOIN movement_lines ml ON ml.movement_id = m.id
          WHERE m.type = 'exit'::text AND m.status = 'confirmed'::text AND m.created_at >= (now() - '30 days'::interval)
          GROUP BY m.warehouse_from_id, ml.product_id
        ), stock AS (
         SELECT inventory_batches.warehouse_id,
            inventory_batches.product_id,
            sum(inventory_batches.quantity_remaining)::numeric(18,6) AS stock_qty
           FROM inventory_batches
          WHERE inventory_batches.quantity_remaining > 0::numeric
          GROUP BY inventory_batches.warehouse_id, inventory_batches.product_id
        ), pending_rows AS (
         SELECT p.warehouse_id,
            pi.product_id,
            p.id AS purchase_id,
            p.po_number,
            p.order_reference,
            p.expected_date,
            p.ordered_date,
            p.created_at,
            s.name AS supplier_name,
            GREATEST(pi.quantity - COALESCE(pi.received_qty, 0::numeric), 0::numeric) * COALESCE(pi.factor_to_base, 1::numeric) AS pending_base_qty
           FROM purchases p
             JOIN purchase_items pi ON pi.purchase_id = p.id
             LEFT JOIN suppliers s ON s.id = p.supplier_id
          WHERE p.destination_type = 'warehouse'::text AND (p.status = ANY (ARRAY['ordered'::text, 'in_transit'::text, 'partially_received'::text])) AND pi.affects_inventory = true AND pi.product_id IS NOT NULL AND GREATEST(pi.quantity - COALESCE(pi.received_qty, 0::numeric), 0::numeric) > 0::numeric
        ), inbound AS (
         SELECT pending_rows.warehouse_id,
            pending_rows.product_id,
            sum(pending_rows.pending_base_qty) AS inbound_qty,
            count(DISTINCT pending_rows.purchase_id)::integer AS pending_purchase_count,
            min(pending_rows.expected_date) FILTER (WHERE pending_rows.expected_date IS NOT NULL) AS next_expected_date,
            sum(pending_rows.pending_base_qty) FILTER (WHERE pending_rows.expected_date < CURRENT_DATE) AS overdue_inbound_qty,
            (array_agg(pending_rows.supplier_name ORDER BY (pending_rows.expected_date IS NULL), pending_rows.expected_date, pending_rows.ordered_date, pending_rows.created_at))[1] AS next_supplier_name,
            (array_agg(COALESCE(pending_rows.po_number, pending_rows.order_reference) ORDER BY (pending_rows.expected_date IS NULL), pending_rows.expected_date, pending_rows.ordered_date, pending_rows.created_at))[1] AS next_order_reference
           FROM pending_rows
          GROUP BY pending_rows.warehouse_id, pending_rows.product_id
        ), keys AS (
         SELECT stock_minimums.warehouse_id,
            stock_minimums.product_id
           FROM stock_minimums
        UNION
         SELECT stock.warehouse_id,
            stock.product_id
           FROM stock
        UNION
         SELECT usage30.warehouse_id,
            usage30.product_id
           FROM usage30
        UNION
         SELECT inbound.warehouse_id,
            inbound.product_id
           FROM inbound
        ), base AS (
         SELECT k.warehouse_id,
            w.name AS warehouse_name,
            k.product_id,
            p.name AS product_name,
            p.base_unit,
            sm.minimum_qty,
            COALESCE(st.stock_qty, 0::numeric)::numeric(18,6) AS stock_qty,
            sm.minimum_qty IS NOT NULL AND COALESCE(st.stock_qty, 0::numeric) <= sm.minimum_qty AS is_critical,
            COALESCE(u.qty_30d, 0::numeric) AS qty_30d,
            COALESCE(u.exit_count_30d, 0::bigint) AS exit_count_30d,
            u.last_exit_at,
            COALESCE(u.qty_30d, 0::numeric) / 30.0 AS avg_daily_30d,
            COALESCE(i.inbound_qty, 0::numeric) AS inbound_qty,
            COALESCE(i.pending_purchase_count, 0) AS pending_purchase_count,
            i.next_expected_date,
            COALESCE(i.overdue_inbound_qty, 0::numeric) AS overdue_inbound_qty,
            i.next_supplier_name,
            i.next_order_reference
           FROM keys k
             JOIN warehouses w ON w.id = k.warehouse_id
             JOIN products p ON p.id = k.product_id
             LEFT JOIN stock_minimums sm ON sm.warehouse_id = k.warehouse_id AND sm.product_id = k.product_id
             LEFT JOIN stock st ON st.warehouse_id = k.warehouse_id AND st.product_id = k.product_id
             LEFT JOIN usage30 u ON u.warehouse_id = k.warehouse_id AND u.product_id = k.product_id
             LEFT JOIN inbound i ON i.warehouse_id = k.warehouse_id AND i.product_id = k.product_id
        ), calc AS (
         SELECT b.warehouse_id,
            b.warehouse_name,
            b.product_id,
            b.product_name,
            b.base_unit,
            b.minimum_qty,
            b.stock_qty,
            b.is_critical,
            b.qty_30d,
            b.exit_count_30d,
            b.last_exit_at,
            b.avg_daily_30d,
            b.inbound_qty,
            b.pending_purchase_count,
            b.next_expected_date,
            b.overdue_inbound_qty,
            b.next_supplier_name,
            b.next_order_reference,
                CASE
                    WHEN b.avg_daily_30d > 0::numeric THEN round(b.stock_qty / b.avg_daily_30d, 1)
                    ELSE NULL::numeric
                END AS coverage_days,
                CASE
                    WHEN b.next_expected_date IS NOT NULL THEN b.next_expected_date - CURRENT_DATE
                    ELSE NULL::integer
                END AS days_to_next_receipt,
                CASE
                    WHEN b.avg_daily_30d > 0::numeric AND b.next_expected_date IS NOT NULL THEN round(b.stock_qty - b.avg_daily_30d * GREATEST(b.next_expected_date - CURRENT_DATE, 0)::numeric, 2)
                    ELSE NULL::numeric
                END AS projected_stock_before_receipt,
                CASE
                    WHEN b.avg_daily_30d > 0::numeric THEN round((b.stock_qty + b.inbound_qty) / b.avg_daily_30d, 1)
                    ELSE NULL::numeric
                END AS coverage_with_inbound_days,
                CASE
                    WHEN b.avg_daily_30d > 0::numeric THEN CURRENT_DATE + ceil(b.stock_qty / b.avg_daily_30d)::integer
                    ELSE NULL::date
                END AS projected_stockout_date,
            round(GREATEST(b.avg_daily_30d * 14::numeric + COALESCE(b.minimum_qty, 0::numeric) - b.stock_qty - b.inbound_qty, 0::numeric), 2) AS recommended_buy_qty
           FROM base b
        )
 SELECT warehouse_id,
    warehouse_name,
    product_id,
    product_name,
    base_unit,
    minimum_qty,
    stock_qty,
    is_critical,
    qty_30d,
    exit_count_30d,
    last_exit_at,
    avg_daily_30d,
    coverage_days,
        CASE
            WHEN minimum_qty IS NOT NULL AND stock_qty <= minimum_qty THEN 'critical'::text
            WHEN avg_daily_30d > 0::numeric AND coverage_days <= 3::numeric THEN 'critical'::text
            WHEN next_expected_date IS NOT NULL AND next_expected_date > CURRENT_DATE AND projected_stock_before_receipt < 0::numeric THEN 'critical'::text
            WHEN overdue_inbound_qty > 0::numeric AND avg_daily_30d > 0::numeric AND coverage_days <= 7::numeric THEN 'critical'::text
            WHEN avg_daily_30d > 0::numeric AND coverage_days <= 7::numeric THEN 'low'::text
            WHEN overdue_inbound_qty > 0::numeric THEN 'low'::text
            WHEN recommended_buy_qty > 0::numeric THEN 'low'::text
            ELSE 'normal'::text
        END AS alert_level,
    inbound_qty,
    pending_purchase_count,
    next_expected_date,
    days_to_next_receipt,
    projected_stock_before_receipt,
    coverage_with_inbound_days,
    projected_stockout_date,
    overdue_inbound_qty,
    next_supplier_name,
    next_order_reference,
    recommended_buy_qty,
        CASE
            WHEN minimum_qty IS NOT NULL AND stock_qty <= minimum_qty THEN 'Stock igual o debajo del mínimo'::text
            WHEN avg_daily_30d > 0::numeric AND coverage_days <= 3::numeric THEN 'Cobertura de 3 días o menos'::text
            WHEN next_expected_date IS NOT NULL AND next_expected_date > CURRENT_DATE AND projected_stock_before_receipt < 0::numeric THEN 'El stock se agotaría antes de la próxima recepción'::text
            WHEN overdue_inbound_qty > 0::numeric AND avg_daily_30d > 0::numeric AND coverage_days <= 7::numeric THEN 'Compra atrasada y cobertura corta'::text
            WHEN avg_daily_30d > 0::numeric AND coverage_days <= 7::numeric THEN 'Cobertura de 7 días o menos'::text
            WHEN overdue_inbound_qty > 0::numeric THEN 'Hay mercadería pendiente con fecha vencida'::text
            WHEN recommended_buy_qty > 0::numeric THEN 'Conviene reponer para recuperar cobertura'::text
            ELSE 'Cobertura normal'::text
        END AS risk_reason
   FROM calc;
