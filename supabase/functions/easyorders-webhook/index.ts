import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-api-key, x-easyorders-secret, secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const configuredSecret = Deno.env.get('EASYORDERS_WEBHOOK_SECRET') || '';

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const url = new URL(req.url);
    const providedSecret =
      req.headers.get('x-easyorders-secret') ||
      req.headers.get('secret') ||
      url.searchParams.get('secret') ||
      '';
    const apiKeyHeader = req.headers.get('x-api-key') || '';

    let authorized = false;
    if (apiKeyHeader) {
      const { data: keyRow } = await supabase
        .from('api_keys')
        .select('id')
        .eq('key_value', apiKeyHeader)
        .eq('active', true)
        .maybeSingle();
      if (keyRow) {
        authorized = true;
        await supabase.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', keyRow.id);
      }
    }
    if (!authorized && configuredSecret && providedSecret === configuredSecret) {
      authorized = true;
    }
    if (!authorized && !configuredSecret && !apiKeyHeader) {
      // Allow initial testing before EASYORDERS_WEBHOOK_SECRET is set
      authorized = true;
    }

    if (!authorized) {
      return new Response(JSON.stringify({ error: 'Unauthorized webhook request' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const rawItems = Array.isArray(body.cart_items)
      ? body.cart_items
      : Array.isArray(body.items)
        ? body.items
        : [];

    const mappedItems = rawItems.map((ci: Record<string, unknown>) => ({
      sku: (ci.product as Record<string, string> | undefined)?.sku || (ci.sku as string) || '',
      finished_product_id: ci.finished_product_id ?? null,
      quantity: Number(ci.quantity || 1),
      unit_price: ci.price !== undefined ? Number(ci.price) : undefined,
    }));

    const { data, error } = await supabase.rpc('erp_create_sales_order', {
      p_payload: {
        external_order_id: String(body.id || body.order_id || `EO-${Date.now()}`),
        channel: 'online_store',
        social_platform: 'none',
        campaign_name: body.utm_campaign || 'sinawy.net (EasyOrders)',
        customer_name: body.full_name || body.customer_name || 'EasyOrders Customer',
        customer_phone: body.phone || body.customer_phone || '',
        city: body.government || body.city || '',
        address: body.address || '',
        payment_method: body.payment_method === 'card' ? 'card' : 'cod',
        payment_status: body.payment_method === 'card' ? 'paid' : 'cod_pending',
        order_status: 'pending',
        discount: Number(body.coupon_discount ?? body.discount ?? 0),
        shipping_charged: Number(body.shipping_cost ?? body.shipping_charged ?? 0),
        shipping_actual_cost: Number(body.shipping_actual_cost ?? 55),
        notes: body.note || body.notes || 'Synced via EasyOrders Webhook',
        raw_payload: body,
        items: mappedItems,
        allow_negative_stock: true,
      },
    });

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ ok: true, ...data }), {
      status: data?.duplicate ? 200 : 201,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message || 'Webhook error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
