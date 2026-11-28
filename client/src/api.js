import { getSupabaseClient, getSupabaseConfig, isSupabaseMode } from './supabase.js';

const TOKEN_KEY = 'sinawy_erp_token';
const USER_KEY = 'sinawy_erp_user';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || '';
}

export function getStoredUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || 'null');
  } catch {
    return null;
  }
}

export function setAuthSession(token, user) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearAuthSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  if (isSupabaseMode()) {
    const sb = getSupabaseClient();
    sb?.auth.signOut().catch(() => {});
  }
}

export async function restoreSession() {
  if (isSupabaseMode()) {
    const sb = getSupabaseClient();
    const { data } = await sb.auth.getSession();
    if (data?.session?.user) {
      const u = data.session.user;
      const userObj = {
        id: u.id,
        email: u.email,
        name: u.user_metadata?.name || u.email?.split('@')[0] || 'Sinawy Admin',
        role: 'admin',
      };
      setAuthSession(data.session.access_token, userObj);
      return userObj;
    }
    return null;
  }
  return getToken() ? getStoredUser() : null;
}

export async function signUpSupabase(email, password, name) {
  const sb = getSupabaseClient();
  if (!sb) throw new Error('Supabase is not configured');
  const { data, error } = await sb.auth.signUp({
    email,
    password,
    options: { data: { name: name || 'Sinawy Admin' } },
  });
  if (error) throw new Error(error.message);
  if (data?.session?.user) {
    const u = data.session.user;
    const userObj = { id: u.id, email: u.email, name: name || u.email, role: 'admin' };
    setAuthSession(data.session.access_token, userObj);
    return { user: userObj, needsEmailConfirm: false };
  }
  return { user: null, needsEmailConfirm: true };
}

/* ==================== SUPABASE ADAPTER ==================== */
async function supabaseApiFetch(path, options = {}) {
  const sb = getSupabaseClient();
  if (!sb) throw new Error('Supabase is not configured');

  const method = (options.method || 'GET').toUpperCase();
  const body = options.body && typeof options.body === 'string' ? JSON.parse(options.body) : options.body || {};
  const [pathname] = path.split('?');

  // Health
  if (pathname === '/api/health') {
    const cfg = getSupabaseConfig();
    return {
      status: 'ok',
      service: 'sinawy-oliveoil-erp',
      db_mode: 'supabase',
      supabase_url: cfg.url,
      timestamp: new Date().toISOString(),
    };
  }

  // Auth login
  if (pathname === '/api/auth/login' && method === 'POST') {
    const { data, error } = await sb.auth.signInWithPassword({
      email: String(body.email || '').trim(),
      password: String(body.password || ''),
    });
    if (error) throw new Error(error.message);
    const u = data.user;
    const userObj = {
      id: u.id,
      email: u.email,
      name: u.user_metadata?.name || u.email?.split('@')[0] || 'Sinawy Admin',
      role: 'admin',
    };
    return { token: data.session.access_token, user: userObj };
  }

  // Seed starter demo data
  if (pathname === '/api/seed-demo' && method === 'POST') {
    const { data, error } = await sb.rpc('erp_seed_demo_data');
    if (error) throw new Error(error.message);
    return data;
  }

  // API keys
  if (pathname === '/api/auth/api-keys' && method === 'GET') {
    const { data, error } = await sb
      .from('api_keys')
      .select('id, name, key_value, active, last_used_at, created_at')
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return { keys: data || [] };
  }
  if (pathname === '/api/auth/api-keys' && method === 'POST') {
    const rnd = Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const { data, error } = await sb
      .from('api_keys')
      .insert({ name: body.name, key_value: `snw_live_${rnd}`, active: true })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return { key: data };
  }
  const keyToggleMatch = pathname.match(/^\/api\/auth\/api-keys\/(\d+)\/toggle$/);
  if (keyToggleMatch && method === 'PATCH') {
    const id = Number(keyToggleMatch[1]);
    const { data: cur, error: e1 } = await sb.from('api_keys').select('active').eq('id', id).single();
    if (e1) throw new Error(e1.message);
    const { data, error } = await sb
      .from('api_keys')
      .update({ active: !cur.active })
      .eq('id', id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return { key: data };
  }

  // Dashboard Summary
  if (pathname === '/api/dashboard/summary' && method === 'GET') {
    const { data, error } = await sb.rpc('erp_get_dashboard_summary');
    if (error) throw new Error(error.message);
    return data;
  }

  // Phase 1: Suppliers (with live balance_due calculation from immutable ledger)
  if (pathname === '/api/purchases/suppliers' && method === 'GET') {
    const viewRes = await sb.from('v_supplier_balances').select('*').order('name', { ascending: true });
    if (!viewRes.error) {
      const suppliers = (viewRes.data || []).map((s) => ({
        ...s,
        default_payment_type: s.default_payment_type || 'cash',
        credit_days: Number(s.credit_days || 0),
        purchase_count: Number(s.purchase_count || 0),
        transaction_count: Number(s.transaction_count || 0),
        total_purchased: Number(s.total_purchased || 0),
        total_paid: Number(s.total_paid || 0),
        net_balance: Number(s.net_balance || 0),
        balance_due: Number(s.balance_due || 0),
        advance_balance: Number(s.advance_balance || 0),
      }));
      return { suppliers };
    }

    // Fallback when Migration 005 has not been applied yet
    const [{ data: sups, error: e1 }, { data: pos, error: e2 }] = await Promise.all([
      sb.from('suppliers').select('*').order('name', { ascending: true }),
      sb.from('purchases').select('supplier_id, total_landed_cost, amount_paid, payment_status'),
    ]);
    if (e1) throw new Error(e1.message);
    if (e2) throw new Error(e2.message);

    const stats = {};
    for (const p of pos || []) {
      if (!p.supplier_id) continue;
      if (!stats[p.supplier_id]) stats[p.supplier_id] = { count: 0, total: 0, paid: 0, due: 0 };
      const tot = Number(p.total_landed_cost || 0);
      const paid = p.amount_paid !== undefined && p.amount_paid !== null
        ? Number(p.amount_paid)
        : p.payment_status === 'paid'
          ? tot
          : 0;
      stats[p.supplier_id].count += 1;
      stats[p.supplier_id].total += tot;
      stats[p.supplier_id].paid += paid;
      stats[p.supplier_id].due += Math.max(0, tot - paid);
    }

    const suppliers = (sups || []).map((s) => {
      const st = stats[s.id] || { count: 0, total: 0, paid: 0, due: 0 };
      return {
        ...s,
        default_payment_type: s.default_payment_type || 'cash',
        credit_days: Number(s.credit_days || 0),
        purchase_count: st.count,
        total_purchased: Number(st.total.toFixed(2)),
        total_paid: Number(st.paid.toFixed(2)),
        net_balance: Number((st.total - st.paid).toFixed(2)),
        balance_due: Number(st.due.toFixed(2)),
        advance_balance: Number(Math.max(0, st.paid - st.total).toFixed(2)),
      };
    });
    return { suppliers };
  }

  // Phase 1: Supplier Statement (chronological ledger + cumulative running balance)
  const supStmtMatch = pathname.match(/^\/api\/purchases\/suppliers\/(\d+)\/statement$/);
  if (supStmtMatch && method === 'GET') {
    const supplierId = Number(supStmtMatch[1]);
    const rpcRes = await sb.rpc('erp_get_supplier_statement', { p_supplier_id: supplierId });
    if (!rpcRes.error && rpcRes.data) {
      return rpcRes.data;
    }

    // Fallback when Migration 005 has not been applied yet
    const [{ data: sup, error: eSup }, { data: pos, error: ePo }, { data: pays, error: ePay }] = await Promise.all([
      sb.from('suppliers').select('*').eq('id', supplierId).single(),
      sb.from('purchases').select('*, raw_materials ( name, name_ar )').eq('supplier_id', supplierId),
      sb.from('supplier_payments').select('*, purchases ( reference_no )').eq('supplier_id', supplierId),
    ]);
    if (eSup) throw new Error(eSup.message);
    if (ePo) throw new Error(ePo.message);
    if (ePay) throw new Error(ePay.message);

    const raw = [];
    for (const p of pos || []) {
      raw.push({
        entry_type: 'purchase',
        sort_rank: 1,
        source_id: p.id,
        entry_date: String(p.purchase_date).slice(0, 10),
        created_at: p.created_at,
        reference_no: p.reference_no,
        purchase_id: p.id,
        purchase_ref: p.reference_no,
        is_reversed: false,
        payment_method: p.payment_type || 'cash',
        description: p.raw_materials?.name || 'Purchase',
        description_ar: p.raw_materials?.name_ar || p.raw_materials?.name || 'فاتورة شراء',
        notes: p.notes || '',
        debit_amount: Number(p.total_landed_cost || 0),
        credit_amount: 0,
      });
    }
    for (const sp of pays || []) {
      const txType = sp.transaction_type || 'payment';
      const isRev = txType === 'reversal';
      raw.push({
        entry_type: txType,
        sort_rank: txType === 'down_payment' ? 2 : txType === 'payment' ? 3 : 4,
        source_id: sp.id,
        entry_date: String(sp.payment_date).slice(0, 10),
        created_at: sp.created_at,
        reference_no: sp.reference_no || `#${sp.id}`,
        purchase_id: sp.purchase_id,
        purchase_ref: sp.purchases?.reference_no || null,
        reversed_payment_id: sp.reversed_payment_id || null,
        is_reversed: false,
        payment_method: sp.payment_method || 'cash',
        description: isRev ? 'Payment reversal' : 'Supplier payment',
        description_ar: isRev ? 'عكس دفعة' : 'سداد دفعة',
        notes: sp.notes || '',
        debit_amount: isRev ? Number(sp.amount || 0) : 0,
        credit_amount: isRev ? 0 : Number(sp.amount || 0),
      });
    }
    raw.sort(
      (a, b) =>
        a.entry_date.localeCompare(b.entry_date) ||
        a.sort_rank - b.sort_rank ||
        String(a.created_at || '').localeCompare(String(b.created_at || '')) ||
        a.source_id - b.source_id
    );
    let running = 0;
    const entries = raw.map((r) => {
      running = Number((running + r.debit_amount - r.credit_amount).toFixed(2));
      return { ...r, running_balance: running };
    });
    const totalPurchased = (pos || []).reduce((acc, p) => acc + Number(p.total_landed_cost || 0), 0);
    const totalPaid = (pos || []).reduce((acc, p) => acc + Number(p.amount_paid || 0), 0);
    return {
      supplier: {
        ...sup,
        total_purchased: Number(totalPurchased.toFixed(2)),
        total_paid: Number(totalPaid.toFixed(2)),
        net_balance: Number((totalPurchased - totalPaid).toFixed(2)),
        balance_due: Number(Math.max(0, totalPurchased - totalPaid).toFixed(2)),
        advance_balance: Number(Math.max(0, totalPaid - totalPurchased).toFixed(2)),
      },
      entries,
    };
  }

  if (pathname === '/api/purchases/suppliers' && method === 'POST') {
    const { data, error } = await sb
      .from('suppliers')
      .insert({
        name: body.name?.trim(),
        name_ar: body.name_ar?.trim() || body.name?.trim(),
        category: body.category || 'general',
        phone: body.phone || '',
        city: body.city || '',
        default_payment_type: body.default_payment_type === 'credit' ? 'credit' : 'cash',
        credit_days: Number(body.credit_days || 0),
        notes: body.notes || '',
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return { supplier: data };
  }
  const supIdMatch = pathname.match(/^\/api\/purchases\/suppliers\/(\d+)$/);
  if (supIdMatch && method === 'PATCH') {
    const id = Number(supIdMatch[1]);
    const patch = {};
    if (body.name !== undefined) patch.name = body.name.trim();
    if (body.name_ar !== undefined) patch.name_ar = body.name_ar.trim();
    if (body.category !== undefined) patch.category = body.category;
    if (body.phone !== undefined) patch.phone = body.phone;
    if (body.city !== undefined) patch.city = body.city;
    if (body.default_payment_type !== undefined) patch.default_payment_type = body.default_payment_type;
    if (body.credit_days !== undefined) patch.credit_days = Number(body.credit_days || 0);
    if (body.notes !== undefined) patch.notes = body.notes;
    const { data, error } = await sb.from('suppliers').update(patch).eq('id', id).select().single();
    if (error) throw new Error(error.message);
    return { supplier: data };
  }
  if (supIdMatch && method === 'DELETE') {
    const { error } = await sb.from('suppliers').delete().eq('id', Number(supIdMatch[1]));
    if (error) throw new Error(error.message);
    return { ok: true };
  }

  // Phase 1: Supplier Payments (Immutable Ledger Transactions)
  if (pathname === '/api/purchases/supplier-payments' && method === 'GET') {
    const viewRes = await sb
      .from('v_supplier_payment_ledger')
      .select('*')
      .order('payment_date', { ascending: false })
      .order('id', { ascending: false });
    if (!viewRes.error) {
      return { payments: viewRes.data || [] };
    }

    // Fallback when Migration 005 has not been applied yet
    const { data, error } = await sb
      .from('supplier_payments')
      .select(`*, suppliers ( name, name_ar ), purchases ( reference_no )`)
      .order('payment_date', { ascending: false })
      .order('id', { ascending: false });
    if (error) throw new Error(error.message);
    const payments = (data || []).map((sp) => ({
      ...sp,
      transaction_type: sp.transaction_type || 'payment',
      signed_amount: sp.transaction_type === 'reversal' ? -Number(sp.amount || 0) : Number(sp.amount || 0),
      is_reversed: false,
      supplier_name: sp.suppliers?.name,
      supplier_name_ar: sp.suppliers?.name_ar,
      purchase_ref: sp.purchases?.reference_no,
    }));
    return { payments };
  }
  if (pathname === '/api/purchases/supplier-payments' && method === 'POST') {
    const { data, error } = await sb.rpc('erp_record_supplier_payment', {
      p_supplier_id: Number(body.supplier_id),
      p_amount: Number(body.amount),
      p_payment_method: body.payment_method || 'cash',
      p_payment_date: body.payment_date || null,
      p_purchase_id: body.purchase_id ? Number(body.purchase_id) : null,
      p_reference_no: body.reference_no || '',
      p_notes: body.notes || '',
    });
    if (error) throw new Error(error.message);
    return { payment: data };
  }
  const supPayRevMatch = pathname.match(/^\/api\/purchases\/supplier-payments\/(\d+)(?:\/reverse)?$/);
  if (supPayRevMatch && (method === 'DELETE' || (method === 'POST' && pathname.endsWith('/reverse')))) {
    const paymentId = Number(supPayRevMatch[1]);
    let { data, error } = await sb.rpc('erp_cancel_supplier_payment', {
      p_payment_id: paymentId,
      p_notes: body.notes || '',
    });
    if (error && /p_notes|function.*does not exist/i.test(error.message || '')) {
      const retry = await sb.rpc('erp_cancel_supplier_payment', { p_payment_id: paymentId });
      data = retry.data;
      error = retry.error;
    }
    if (error) throw new Error(error.message);
    return data;
  }

  // Phase 1: Raw Materials
  if (pathname === '/api/purchases/materials' && method === 'GET') {
    const { data, error } = await sb.from('raw_materials').select('*').order('name', { ascending: true });
    if (error) throw new Error(error.message);
    const order = { oil: 1, container: 2, sticker: 3, packaging: 4 };
    const materials = (data || [])
      .map((m) => ({
        ...m,
        equivalent_gallons:
          m.category === 'oil' && Number(m.units_per_purchase) > 0
            ? Number((Number(m.stock_qty) / Number(m.units_per_purchase)).toFixed(2))
            : null,
      }))
      .sort((a, b) => (order[a.category] || 9) - (order[b.category] || 9) || a.name.localeCompare(b.name));
    return { materials };
  }
  if (pathname === '/api/purchases/materials' && method === 'POST') {
    const isOil = body.category === 'oil';
    const { data, error } = await sb
      .from('raw_materials')
      .insert({
        code: String(body.code || '').trim().toUpperCase(),
        name: String(body.name || '').trim(),
        name_ar: String(body.name_ar || body.name || '').trim(),
        category: body.category,
        container_material: body.category === 'container' ? body.container_material || 'glass' : 'none',
        capacity_ml: body.capacity_ml ? Number(body.capacity_ml) : null,
        base_unit: body.base_unit || (isOil ? 'litre' : 'pcs'),
        purchase_unit: body.purchase_unit || (isOil ? 'gallon_17l' : 'pcs'),
        units_per_purchase: Number(body.units_per_purchase) || (isOil ? 17 : 1),
        min_stock: Number(body.min_stock) || 0,
        notes: body.notes || '',
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return { material: data };
  }

  const matPatchMatch = pathname.match(/^\/api\/purchases\/materials\/(\d+)$/);
  if (matPatchMatch && method === 'PATCH') {
    const id = Number(matPatchMatch[1]);
    const isOil = body.category === 'oil';
    const patch = {
      updated_at: new Date().toISOString(),
    };
    if (body.code !== undefined) patch.code = String(body.code).trim().toUpperCase();
    if (body.name !== undefined) patch.name = String(body.name).trim();
    if (body.name_ar !== undefined) patch.name_ar = String(body.name_ar).trim();
    if (body.category !== undefined) {
      patch.category = body.category;
      patch.base_unit = isOil ? 'litre' : 'pcs';
      patch.purchase_unit = isOil ? 'gallon_17l' : 'pcs';
      patch.container_material = body.category === 'container' ? body.container_material || 'glass' : 'none';
      patch.capacity_ml = body.category === 'container' && body.capacity_ml ? Number(body.capacity_ml) : null;
    }
    if (body.units_per_purchase !== undefined && body.units_per_purchase !== '') {
      patch.units_per_purchase = Number(body.units_per_purchase);
    }
    if (body.stock_qty !== undefined && body.stock_qty !== '') patch.stock_qty = Number(body.stock_qty);
    if (body.avg_unit_cost !== undefined && body.avg_unit_cost !== '') patch.avg_unit_cost = Number(body.avg_unit_cost);
    if (body.min_stock !== undefined && body.min_stock !== '') patch.min_stock = Number(body.min_stock);
    if (body.notes !== undefined) patch.notes = body.notes;
    const { data, error } = await sb.from('raw_materials').update(patch).eq('id', id).select().single();
    if (error) throw new Error(error.message);
    return { material: data };
  }

  // Phase 1: Purchases (with dynamic ledger-computed amount_paid, remaining_due & payment_status)
  if (pathname === '/api/purchases' && method === 'GET') {
    const viewRes = await sb
      .from('v_purchase_balances')
      .select('*')
      .order('purchase_date', { ascending: false })
      .order('id', { ascending: false });
    if (!viewRes.error) {
      return { purchases: viewRes.data || [] };
    }

    // Fallback when Migration 005 has not been applied yet
    const { data, error } = await sb
      .from('purchases')
      .select(`
        *,
        raw_materials ( code, name, name_ar, category, base_unit, purchase_unit ),
        suppliers ( name, name_ar )
      `)
      .order('purchase_date', { ascending: false })
      .order('id', { ascending: false });
    if (error) throw new Error(error.message);
    const purchases = (data || []).map((p) => {
      const tot = Number(p.total_landed_cost || 0);
      const paid = p.amount_paid !== undefined && p.amount_paid !== null ? Number(p.amount_paid) : tot;
      return {
        ...p,
        payment_type: p.payment_type || 'cash',
        amount_paid: paid,
        remaining_due: Number(Math.max(0, tot - paid).toFixed(2)),
        material_code: p.raw_materials?.code,
        material_name: p.raw_materials?.name,
        material_name_ar: p.raw_materials?.name_ar,
        material_category: p.raw_materials?.category,
        base_unit: p.raw_materials?.base_unit,
        purchase_unit: p.raw_materials?.purchase_unit,
        supplier_name: p.suppliers?.name,
        supplier_name_ar: p.suppliers?.name_ar,
      };
    });
    return { purchases };
  }
  if (pathname === '/api/purchases' && method === 'POST') {
    const rpcPayload = {
      p_raw_material_id: Number(body.raw_material_id),
      p_purchase_qty: Number(body.purchase_qty),
      p_unit_price: Number(body.unit_price),
      p_units_per_purchase: Number(body.units_per_purchase) || null,
      p_hidden_cost: Number(body.hidden_cost) || 0,
      p_supplier_id: body.supplier_id ? Number(body.supplier_id) : null,
      p_purchase_date: body.purchase_date || null,
      p_harvest_lot: body.harvest_lot || '',
      p_payment_status: body.payment_status || 'paid',
      p_notes: body.notes || '',
      p_payment_type: body.payment_type === 'credit' ? 'credit' : 'cash',
      p_amount_paid: body.payment_type === 'credit' ? Number(body.amount_paid || 0) : null,
      p_due_date: body.due_date || null,
      p_payment_method: body.payment_method || 'cash',
    };
    let { data, error } = await sb.rpc('erp_record_purchase', rpcPayload);
    if (error && /p_payment_method|function.*does not exist/i.test(error.message || '')) {
      const { p_payment_method: _omit, ...legacyPayload } = rpcPayload;
      const retry = await sb.rpc('erp_record_purchase', legacyPayload);
      data = retry.data;
      error = retry.error;
    }
    if (error) throw new Error(error.message);
    return { purchase: data };
  }
  const purchasePatchMatch = pathname.match(/^\/api\/purchases\/(\d+)$/);
  if (purchasePatchMatch && method === 'PATCH') {
    const { data, error } = await sb.rpc('erp_update_purchase', {
      p_purchase_id: Number(purchasePatchMatch[1]),
      p_raw_material_id: Number(body.raw_material_id),
      p_purchase_qty: Number(body.purchase_qty),
      p_unit_price: Number(body.unit_price),
      p_units_per_purchase: Number(body.units_per_purchase) || null,
      p_hidden_cost: Number(body.hidden_cost) || 0,
      p_supplier_id: body.supplier_id ? Number(body.supplier_id) : null,
      p_purchase_date: body.purchase_date || null,
      p_harvest_lot: body.harvest_lot || '',
      p_payment_type: body.payment_type === 'credit' ? 'credit' : 'cash',
      p_amount_paid: body.payment_type === 'credit' ? Number(body.amount_paid || 0) : null,
      p_due_date: body.payment_type === 'credit' && body.due_date ? body.due_date : null,
      p_notes: body.notes || '',
    });
    if (error) throw new Error(error.message);
    return { purchase: data };
  }

  // Phase 1: Hidden Costs
  if (pathname === '/api/purchases/hidden-costs' && method === 'GET') {
    const { data, error } = await sb
      .from('hidden_costs')
      .select('*')
      .order('cost_date', { ascending: false })
      .order('id', { ascending: false });
    if (error) throw new Error(error.message);
    return { hidden_costs: data || [] };
  }
  if (pathname === '/api/purchases/hidden-costs' && method === 'POST') {
    const { data, error } = await sb
      .from('hidden_costs')
      .insert({
        cost_date: body.cost_date || new Date().toISOString().slice(0, 10),
        category: body.category || 'other',
        title: String(body.title || '').trim(),
        title_ar: String(body.title_ar || body.title || '').trim(),
        amount: Number(body.amount),
        allocation_scope: body.allocation_scope || 'overhead',
        related_ref: body.related_ref || '',
        notes: body.notes || '',
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return { hidden_cost: data };
  }
  const hcDelMatch = pathname.match(/^\/api\/purchases\/hidden-costs\/(\d+)$/);
  if (hcDelMatch && method === 'DELETE') {
    const { error } = await sb
      .from('hidden_costs')
      .delete()
      .eq('id', Number(hcDelMatch[1]))
      .eq('allocation_scope', 'overhead');
    if (error) throw new Error(error.message);
    return { ok: true };
  }

  // Phase 2: Finished Products & Live Yield
  if (pathname === '/api/bottling/products' && method === 'GET') {
    const [{ data: fps, error: e1 }, { data: rms, error: e2 }] = await Promise.all([
      sb.from('finished_products').select('*').order('size_ml', { ascending: true }).order('name', { ascending: true }),
      sb.from('raw_materials').select('*'),
    ]);
    if (e1) throw new Error(e1.message);
    if (e2) throw new Error(e2.message);
    const byId = Object.fromEntries((rms || []).map((m) => [m.id, m]));

    const products = (fps || []).map((p) => {
      const oil = byId[p.oil_material_id];
      const cnt = byId[p.container_material_id];
      const stk = byId[p.sticker_material_id];
      const ext = byId[p.extra_material_id];

      const limits = [];
      if (oil && Number(p.oil_litres_per_unit) > 0) {
        limits.push({ key: 'oil', max: Math.floor(Number(oil.stock_qty) / Number(p.oil_litres_per_unit)) });
      }
      if (cnt && Number(p.containers_per_unit) > 0) {
        limits.push({ key: 'container', max: Math.floor(Number(cnt.stock_qty) / Number(p.containers_per_unit)) });
      }
      if (stk && Number(p.stickers_per_unit) > 0) {
        limits.push({ key: 'sticker', max: Math.floor(Number(stk.stock_qty) / Number(p.stickers_per_unit)) });
      }
      if (ext && Number(p.extra_qty_per_unit) > 0) {
        limits.push({ key: 'extra', max: Math.floor(Number(ext.stock_qty) / Number(p.extra_qty_per_unit)) });
      }
      limits.sort((a, b) => a.max - b.max);

      const estBomCost = Number(
        (
          Number(p.oil_litres_per_unit || 0) * Number(oil?.avg_unit_cost || 0) +
          Number(p.containers_per_unit || 0) * Number(cnt?.avg_unit_cost || 0) +
          Number(p.stickers_per_unit || 0) * Number(stk?.avg_unit_cost || 0) +
          Number(p.extra_qty_per_unit || 0) * Number(ext?.avg_unit_cost || 0)
        ).toFixed(2)
      );

      return {
        ...p,
        oil_name: oil?.name,
        oil_name_ar: oil?.name_ar,
        oil_stock_qty: oil?.stock_qty ?? 0,
        oil_unit_cost: oil?.avg_unit_cost ?? 0,
        container_name: cnt?.name,
        container_name_ar: cnt?.name_ar,
        container_stock_qty: cnt?.stock_qty ?? 0,
        container_unit_cost: cnt?.avg_unit_cost ?? 0,
        sticker_name: stk?.name,
        sticker_name_ar: stk?.name_ar,
        sticker_stock_qty: stk?.stock_qty ?? 0,
        sticker_unit_cost: stk?.avg_unit_cost ?? 0,
        extra_name: ext?.name,
        extra_name_ar: ext?.name_ar,
        extra_stock_qty: ext?.stock_qty ?? 0,
        extra_unit_cost: ext?.avg_unit_cost ?? 0,
        max_producible: limits.length > 0 ? Math.max(0, limits[0].max) : 0,
        bottleneck: limits.length > 0 ? limits[0].key : null,
        estimated_bom_cost: estBomCost,
      };
    });
    return { products };
  }
  if (pathname === '/api/bottling/products' && method === 'POST') {
    const sku = String(body.sku || '').trim().toUpperCase();
    const { data, error } = await sb
      .from('finished_products')
      .insert({
        sku,
        external_sku: String(body.external_sku || sku).trim(),
        name: String(body.name || '').trim(),
        name_ar: String(body.name_ar || body.name || '').trim(),
        oil_type: body.oil_type || 'extra_virgin',
        container_type: body.container_type || 'glass',
        size_ml: Number(body.size_ml || 500),
        oil_material_id: body.oil_material_id ? Number(body.oil_material_id) : null,
        oil_litres_per_unit: Number(body.oil_litres_per_unit) || Number(body.size_ml || 500) / 1000,
        container_material_id: body.container_material_id ? Number(body.container_material_id) : null,
        containers_per_unit: Number(body.containers_per_unit || 1),
        sticker_material_id: body.sticker_material_id ? Number(body.sticker_material_id) : null,
        stickers_per_unit: Number(body.stickers_per_unit || 1),
        extra_material_id: body.extra_material_id ? Number(body.extra_material_id) : null,
        extra_qty_per_unit: Number(body.extra_qty_per_unit || 0),
        retail_price: Number(body.retail_price || 0),
        min_stock: Number(body.min_stock || 10),
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return { product: data };
  }
  const prodPatchMatch = pathname.match(/^\/api\/bottling\/products\/(\d+)$/);
  if (prodPatchMatch && method === 'PATCH') {
    const id = Number(prodPatchMatch[1]);
    const patch = { updated_at: new Date().toISOString() };
    if (body.sku !== undefined) patch.sku = String(body.sku).trim().toUpperCase();
    if (body.external_sku !== undefined) patch.external_sku = String(body.external_sku).trim();
    if (body.name !== undefined) patch.name = String(body.name).trim();
    if (body.name_ar !== undefined) patch.name_ar = String(body.name_ar).trim();
    if (body.oil_type !== undefined) patch.oil_type = body.oil_type;
    if (body.container_type !== undefined) patch.container_type = body.container_type;
    if (body.size_ml !== undefined && body.size_ml !== '') patch.size_ml = Number(body.size_ml);
    if (body.oil_material_id !== undefined) patch.oil_material_id = body.oil_material_id ? Number(body.oil_material_id) : null;
    if (body.oil_litres_per_unit !== undefined && body.oil_litres_per_unit !== '') patch.oil_litres_per_unit = Number(body.oil_litres_per_unit);
    if (body.container_material_id !== undefined) patch.container_material_id = body.container_material_id ? Number(body.container_material_id) : null;
    if (body.containers_per_unit !== undefined && body.containers_per_unit !== '') patch.containers_per_unit = Number(body.containers_per_unit);
    if (body.sticker_material_id !== undefined) patch.sticker_material_id = body.sticker_material_id ? Number(body.sticker_material_id) : null;
    if (body.stickers_per_unit !== undefined && body.stickers_per_unit !== '') patch.stickers_per_unit = Number(body.stickers_per_unit);
    if (body.extra_material_id !== undefined) patch.extra_material_id = body.extra_material_id ? Number(body.extra_material_id) : null;
    if (body.extra_qty_per_unit !== undefined && body.extra_qty_per_unit !== '') patch.extra_qty_per_unit = Number(body.extra_qty_per_unit);
    if (body.retail_price !== undefined && body.retail_price !== '') patch.retail_price = Number(body.retail_price);
    if (body.min_stock !== undefined && body.min_stock !== '') patch.min_stock = Number(body.min_stock);
    if (body.stock_qty !== undefined && body.stock_qty !== '') patch.stock_qty = Math.floor(Number(body.stock_qty));
    if (body.unit_cogs !== undefined && body.unit_cogs !== '') patch.unit_cogs = Number(body.unit_cogs);
    if (body.active !== undefined) patch.active = Boolean(body.active);
    const { data, error } = await sb.from('finished_products').update(patch).eq('id', id).select().single();
    if (error) throw new Error(error.message);
    return { product: data };
  }

  // Phase 2: Bottling Batches
  if (pathname === '/api/bottling/batches' && method === 'GET') {
    const { data, error } = await sb
      .from('bottling_batches')
      .select(`*, finished_products ( sku, name, name_ar, container_type, size_ml, retail_price )`)
      .order('batch_date', { ascending: false })
      .order('id', { ascending: false });
    if (error) throw new Error(error.message);
    const batches = (data || []).map((b) => ({
      ...b,
      sku: b.finished_products?.sku,
      product_name: b.finished_products?.name,
      product_name_ar: b.finished_products?.name_ar,
      container_type: b.finished_products?.container_type,
      size_ml: b.finished_products?.size_ml,
      retail_price: b.finished_products?.retail_price,
    }));
    return { batches };
  }
  if (pathname === '/api/bottling/batches' && method === 'POST') {
    const { data, error } = await sb.rpc('erp_run_bottling_batch', {
      p_finished_product_id: Number(body.finished_product_id),
      p_quantity_produced: Number(body.quantity_produced),
      p_spillage_litres: Number(body.spillage_litres || 0),
      p_batch_hidden_cost: Number(body.batch_hidden_cost || 0),
      p_batch_date: body.batch_date || null,
      p_harvest_note: body.harvest_note || '',
      p_notes: body.notes || '',
    });
    if (error) throw new Error(error.message);
    return { batch: data };
  }
  const batchPatchMatch = pathname.match(/^\/api\/bottling\/batches\/(\d+)$/);
  if (batchPatchMatch && method === 'PATCH') {
    const { data, error } = await sb.rpc('erp_update_bottling_batch', {
      p_batch_id: Number(batchPatchMatch[1]),
      p_quantity_produced: Number(body.quantity_produced),
      p_spillage_litres: Number(body.spillage_litres || 0),
      p_batch_hidden_cost: Number(body.batch_hidden_cost || 0),
      p_batch_date: body.batch_date || null,
      p_harvest_note: body.harvest_note || '',
      p_notes: body.notes || '',
    });
    if (error) throw new Error(error.message);
    return { batch: data };
  }

  // Phase 3: Sales Orders
  if (pathname === '/api/sales/orders' && method === 'GET') {
    const { data, error } = await sb
      .from('sales_orders')
      .select(`*, sales_order_items ( * )`)
      .order('order_date', { ascending: false })
      .order('id', { ascending: false });
    if (error) throw new Error(error.message);
    const orders = (data || []).map((o) => ({
      ...o,
      items: o.sales_order_items || [],
    }));
    return { orders };
  }
  if (pathname === '/api/sales/orders' && method === 'POST') {
    const { data, error } = await sb.rpc('erp_create_sales_order', { p_payload: body });
    if (error) throw new Error(error.message);
    return data;
  }
  const orderPatchMatch = pathname.match(/^\/api\/sales\/orders\/(\d+)$/);
  if (orderPatchMatch && method === 'PATCH') {
    const { data, error } = await sb.rpc('erp_update_order_status', {
      p_order_id: Number(orderPatchMatch[1]),
      p_order_status: body.order_status || null,
      p_payment_status: body.payment_status || null,
      p_shipping_actual_cost: body.shipping_actual_cost !== undefined ? Number(body.shipping_actual_cost) : null,
      p_notes: body.notes ?? null,
    });
    if (error) throw new Error(error.message);
    return { order: data };
  }

  // Phase 3: Ad Spend
  if (pathname === '/api/sales/ad-spend' && method === 'GET') {
    const { data, error } = await sb
      .from('ad_spend')
      .select('*')
      .order('spend_date', { ascending: false })
      .order('id', { ascending: false });
    if (error) throw new Error(error.message);
    return { ad_spend: data || [] };
  }
  if (pathname === '/api/sales/ad-spend' && method === 'POST') {
    const { data, error } = await sb
      .from('ad_spend')
      .insert({
        spend_date: body.spend_date || new Date().toISOString().slice(0, 10),
        platform: body.platform || 'facebook',
        campaign_name: String(body.campaign_name || '').trim(),
        amount: Number(body.amount),
        notes: body.notes || '',
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return { entry: data };
  }
  const adDelMatch = pathname.match(/^\/api\/sales\/ad-spend\/(\d+)$/);
  if (adDelMatch && method === 'DELETE') {
    const { error } = await sb.from('ad_spend').delete().eq('id', Number(adDelMatch[1]));
    if (error) throw new Error(error.message);
    return { ok: true };
  }

  // Integrations: Simulate EasyOrders Order
  if (pathname === '/api/integrations/easyorders/simulate' && method === 'POST') {
    const { data: fps, error: e1 } = await sb
      .from('finished_products')
      .select('id, sku, external_sku, retail_price')
      .eq('active', true)
      .gt('stock_qty', 0)
      .order('id', { ascending: true })
      .limit(1);
    if (e1) throw new Error(e1.message);
    if (!fps || fps.length === 0) {
      throw new Error('No finished products in stock to simulate an order');
    }
    const fp = fps[0];
    const simId = `EO-SIM-${Math.floor(100000 + Math.random() * 900000)}`;
    const { data, error } = await sb.rpc('erp_create_sales_order', {
      p_payload: {
        external_order_id: simId,
        channel: 'online_store',
        social_platform: 'none',
        campaign_name: 'sinawy.net (EasyOrders Test)',
        customer_name: 'Tarek El-Masry / طارق المصري',
        customer_phone: '01092837465',
        city: 'Cairo - New Cairo',
        address: '5th Settlement, District 3',
        payment_method: 'cod',
        payment_status: 'cod_pending',
        order_status: 'pending',
        shipping_charged: 65,
        shipping_actual_cost: 55,
        notes: 'Simulated EasyOrders webhook order',
        items: [{ finished_product_id: fp.id, quantity: 1, unit_price: Number(fp.retail_price) }],
      },
    });
    if (error) throw new Error(error.message);
    return { ok: true, order: data.order };
  }

  throw new Error(`Unsupported Supabase route: ${method} ${pathname}`);
}

/* ==================== UNIFIED API FETCH ==================== */
export async function apiFetch(path, options = {}) {
  if (isSupabaseMode()) {
    return supabaseApiFetch(path, options);
  }

  const token = getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };

  const res = await fetch(path, {
    ...options,
    headers,
    body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body,
  });

  if (res.status === 401 && path !== '/api/auth/login') {
    clearAuthSession();
    window.dispatchEvent(new Event('sinawy-auth-expired'));
  }

  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }

  return data;
}

export async function downloadCsv(path, filename) {
  if (isSupabaseMode()) {
    const { orders } = await supabaseApiFetch('/api/sales/orders', { method: 'GET' });
    const headers = [
      'Order No', 'Date', 'Channel', 'Platform', 'Campaign', 'Customer', 'Phone', 'City',
      'Status', 'Payment', 'Subtotal (EGP)', 'Discount (EGP)', 'Shipping Charged',
      'Shipping Actual', 'Total (EGP)', 'COGS (EGP)', 'Net Profit (EGP)',
    ];
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [headers.join(',')];
    for (const o of orders) {
      lines.push(
        [
          o.order_no, String(o.order_date).slice(0, 10), o.channel, o.social_platform,
          o.campaign_name, o.customer_name, o.customer_phone, o.city, o.order_status,
          o.payment_method, o.subtotal, o.discount, o.shipping_charged, o.shipping_actual_cost,
          o.total_amount, o.total_cogs, o.net_profit,
        ].map(esc).join(',')
      );
    }
    const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return;
  }

  const token = getToken();
  const res = await fetch(path, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error('Export failed');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
