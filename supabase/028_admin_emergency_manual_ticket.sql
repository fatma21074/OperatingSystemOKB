-- v273: Admin-only emergency re-entry on the Dashboard. Review on staging before production.
-- Preserves the existing get_next_order_ticket() generator and all financial triggers.
-- Installation prerequisite: confirm no duplicate nonempty ticket_id/order_barcode values.
-- The unique indexes are an intentional safety guard against concurrent duplicate saves.
CREATE UNIQUE INDEX IF NOT EXISTS okb_orders_ticket_id_unique_v273
  ON public.orders(ticket_id) WHERE ticket_id IS NOT NULL AND ticket_id <> '';
CREATE UNIQUE INDEX IF NOT EXISTS okb_orders_order_barcode_unique_v273
  ON public.orders(order_barcode) WHERE order_barcode IS NOT NULL AND order_barcode <> '';

CREATE OR REPLACE FUNCTION public.okb_admin_create_emergency_ticket(p_order jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_ticket text;
  v_barcode text;
  v_max bigint;
  v_allowed text[] := ARRAY[
    'ticket_id','order_barcode','employee_name','doctor_name','order_number',
    'customer_name','phone','phone2','shipping_company','area','price','deposit',
    'quantity','delivery_fee','status','fake_doctor','notes','product_names',
    'branch','created_at'
  ];
  v_key text;
  v_cols text;
  v_expr text;
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR private.okb_current_user_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Admin only';
  END IF;
  IF p_order IS NULL OR jsonb_typeof(p_order) <> 'object' THEN
    RAISE EXCEPTION 'Invalid order payload';
  END IF;
  FOR v_key IN SELECT jsonb_object_keys(p_order) LOOP
    IF NOT v_key=ANY(v_allowed) THEN
      RAISE EXCEPTION 'Unexpected field: %',v_key;
    END IF;
  END LOOP;
  v_ticket := p_order->>'ticket_id';
  IF v_ticket IS NULL OR v_ticket !~ '^[0-9]{1,10}$' OR v_ticket::bigint <= 0 THEN
    RAISE EXCEPTION 'Invalid emergency Ticket ID';
  END IF;
  v_ticket := lpad((v_ticket::bigint)::text,5,'0');
  v_barcode := '11000000000'||v_ticket;
  IF p_order->>'order_barcode' IS DISTINCT FROM v_barcode THEN
    RAISE EXCEPTION 'Barcode/Ticket mismatch';
  END IF;
  -- Historical IDs only: protect the auto sequence from newly created future collisions.
  SELECT max(CASE WHEN ticket_id ~ '^[0-9]{1,10}$' THEN ticket_id::bigint END)
    INTO v_max FROM public.orders;
  IF v_max IS NULL OR v_ticket::bigint >= v_max THEN
    RAISE EXCEPTION 'Emergency ID must be below the largest existing issued Ticket ID';
  END IF;
  IF EXISTS (SELECT 1 FROM public.orders WHERE ticket_id=v_ticket OR order_barcode=v_barcode) THEN
    RAISE EXCEPTION 'Ticket ID already exists';
  END IF;
  SELECT string_agg(format('%I',key),','),string_agg(format('r.%I',key),',')
    INTO v_cols,v_expr FROM jsonb_object_keys(p_order) AS key;
  EXECUTE format(
    'INSERT INTO public.orders (%s) SELECT %s FROM jsonb_populate_record(NULL::public.orders,$1) r RETURNING to_jsonb(orders.*)',
    v_cols,v_expr
  ) INTO v_result USING p_order;
  RETURN v_result;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'Ticket ID or barcode already exists';
END;
$fn$;
REVOKE ALL ON FUNCTION public.okb_admin_create_emergency_ticket(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.okb_admin_create_emergency_ticket(jsonb) TO authenticated;
