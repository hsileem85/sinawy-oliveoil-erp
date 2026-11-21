import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-api-key',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const apiKey = req.headers.get('x-api-key') || '';
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'Missing X-API-Key header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: keyRow } = await supabase
      .from('api_keys')
      .select('id')
      .eq('key_value', apiKey)
      .eq('active', true)
      .maybeSingle();

    if (!keyRow) {
      return new Response(JSON.stringify({ error: 'Invalid or revoked API key' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    await supabase.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', keyRow.id);

    const { data: products, error } = await supabase
      .from('finished_products')
      .select('id, sku, external_sku, name, name_ar, container_type, size_ml, stock_qty, retail_price, active, updated_at')
      .order('sku', { ascending: true });

    if (error) throw error;

    return new Response(
      JSON.stringify({
        store: 'sinawy.net',
        currency: 'EGP',
        synced_at: new Date().toISOString(),
        products: products || [],
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message || 'Failed to fetch stock' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
