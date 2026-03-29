const { createClient } = require('@supabase/supabase-js');

// ── SUPABASE CONNECTION ──
// Public client — for user-facing operations (respects RLS)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Admin client — for server-side admin operations (bypasses RLS)
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ── USER FUNCTIONS ──

// Get user profile by ID
const getProfile = async (userId) => {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();
  if (error) throw error;
  return data;
};

// Get all users (admin only)
const getAllUsers = async () => {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
};

// Update user role (admin only)
const updateUserRole = async (userId, role) => {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .update({ role, updated_at: new Date().toISOString() })
    .eq('id', userId);
  if (error) throw error;
  return data;
};

// Update user plan
const updateUserPlan = async (userId, plan, status = 'active') => {
  const limits = { starter: 500, professional: -1, business: -1, enterprise: -1 };
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .update({
      plan,
      plan_status: status,
      searches_limit: limits[plan] || 500,
      updated_at: new Date().toISOString()
    })
    .eq('id', userId);
  if (error) throw error;
  return data;
};

// Get platform stats (admin only)
const getPlatformStats = async () => {
  const { data: users, error } = await supabaseAdmin
    .from('profiles')
    .select('plan, role, created_at');
  if (error) throw error;
  const stats = {
    total: users.length,
    byPlan: {
      starter: users.filter(u => u.plan === 'starter').length,
      professional: users.filter(u => u.plan === 'professional').length,
      business: users.filter(u => u.plan === 'business').length,
      enterprise: users.filter(u => u.plan === 'enterprise').length,
    },
    admins: users.filter(u => ['admin','super_admin'].includes(u.role)).length,
    newToday: users.filter(u => {
      const today = new Date().toDateString();
      return new Date(u.created_at).toDateString() === today;
    }).length,
  };
  return stats;
};

module.exports = { supabase, supabaseAdmin, getProfile, getAllUsers, updateUserRole, updateUserPlan, getPlatformStats };
