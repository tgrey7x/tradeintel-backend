const express = require('express');
const router = express.Router();
const { supabaseAdmin } = require('./db');

// ── AUTH ROUTES ──
// All routes are prefixed with /auth in server.js

// ── REGISTER (email + password) ──
router.post('/register', async (req, res) => {
  try {
    const { email, password, full_name } = req.body;
    if (!email || !password || !full_name) {
      return res.status(400).json({ success: false, error: 'Email, password and name are required' });
    }
    if (password.length < 8) {
      return res.status(400).json({ success: false, error: 'Password must be at least 8 characters' });
    }
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      user_metadata: { full_name },
      email_confirm: true,
    });
    if (error) throw error;
    res.json({ success: true, message: 'Account created successfully! Please check your email to verify your account.', userId: data.user.id });
  } catch (error) {
    console.error('Register error:', error);
    res.status(400).json({ success: false, error: error.message });
  }
});

// ── LOGIN (email + password) ──
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password are required' });
    }
    const { data, error } = await supabaseAdmin.auth.signInWithPassword({ email, password });
    if (error) throw error;
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', data.user.id)
      .single();
    res.json({
      success: true,
      token: data.session.access_token,
      user: {
        id: data.user.id,
        email: data.user.email,
        full_name: profile?.full_name || '',
        role: profile?.role || 'user',
        plan: profile?.plan || 'starter',
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(401).json({ success: false, error: 'Invalid email or password' });
  }
});

// ── GET CURRENT USER ──
router.get('/me', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ success: false, error: 'No token provided' });
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !user) return res.status(401).json({ success: false, error: 'Invalid token' });
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();
    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        full_name: profile?.full_name || '',
        role: profile?.role || 'user',
        plan: profile?.plan || 'starter',
        searches_used: profile?.searches_used || 0,
        searches_limit: profile?.searches_limit || 500,
        created_at: user.created_at,
      }
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ── LOGOUT ──
router.post('/logout', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (token) await supabaseAdmin.auth.admin.signOut(token);
    res.json({ success: true, message: 'Logged out successfully' });
  } catch (error) {
    res.json({ success: true, message: 'Logged out' });
  }
});

// ── REQUEST PASSWORD RESET ──
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, error: 'Email is required' });
    const { error } = await supabaseAdmin.auth.resetPasswordForEmail(email);
    if (error) throw error;
    res.json({ success: true, message: 'Password reset email sent! Check your inbox.' });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(400).json({ success: false, error: error.message });
  }
});

// ── ADMIN ROUTES ──

// Get all users (super_admin only)
router.get('/admin/users', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const { data: { user } } = await supabaseAdmin.auth.getUser(token);
    const { data: profile } = await supabaseAdmin.from('profiles').select('role').eq('id', user.id).single();
    if (!['admin', 'super_admin'].includes(profile?.role)) {
      return res.status(403).json({ success: false, error: 'Admin access required' });
    }
    const { data: users, error } = await supabaseAdmin.from('profiles').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ success: true, users });
  } catch (error) {
    console.error('Admin users error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update user role (super_admin only)
router.put('/admin/users/:userId/role', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const { data: { user } } = await supabaseAdmin.auth.getUser(token);
    const { data: profile } = await supabaseAdmin.from('profiles').select('role').eq('id', user.id).single();
    if (profile?.role !== 'super_admin') {
      return res.status(403).json({ success: false, error: 'Super admin access required' });
    }
    const { role } = req.body;
    const validRoles = ['user', 'manager', 'admin', 'super_admin'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ success: false, error: 'Invalid role' });
    }
    const { error } = await supabaseAdmin.from('profiles').update({ role, updated_at: new Date().toISOString() }).eq('id', req.params.userId);
    if (error) throw error;
    res.json({ success: true, message: 'User role updated successfully' });
  } catch (error) {
    console.error('Update role error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update user plan (admin only)
router.put('/admin/users/:userId/plan', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const { data: { user } } = await supabaseAdmin.auth.getUser(token);
    const { data: profile } = await supabaseAdmin.from('profiles').select('role').eq('id', user.id).single();
    if (!['admin', 'super_admin'].includes(profile?.role)) {
      return res.status(403).json({ success: false, error: 'Admin access required' });
    }
    const { plan } = req.body;
    const validPlans = ['starter', 'professional', 'business', 'enterprise'];
    if (!validPlans.includes(plan)) {
      return res.status(400).json({ success: false, error: 'Invalid plan' });
    }
    const limits = { starter: 500, professional: -1, business: -1, enterprise: -1 };
    const { error } = await supabaseAdmin.from('profiles').update({ plan, searches_limit: limits[plan], updated_at: new Date().toISOString() }).eq('id', req.params.userId);
    if (error) throw error;
    res.json({ success: true, message: 'User plan updated successfully' });
  } catch (error) {
    console.error('Update plan error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get platform stats (admin only)
router.get('/admin/stats', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const { data: { user } } = await supabaseAdmin.auth.getUser(token);
    const { data: profile } = await supabaseAdmin.from('profiles').select('role').eq('id', user.id).single();
    if (!['admin', 'super_admin'].includes(profile?.role)) {
      return res.status(403).json({ success: false, error: 'Admin access required' });
    }
    const { data: users } = await supabaseAdmin.from('profiles').select('plan, role, created_at');
    const today = new Date().toDateString();
    const stats = {
      total_users: users.length,
      new_today: users.filter(u => new Date(u.created_at).toDateString() === today).length,
      by_plan: {
        starter: users.filter(u => u.plan === 'starter').length,
        professional: users.filter(u => u.plan === 'professional').length,
        business: users.filter(u => u.plan === 'business').length,
        enterprise: users.filter(u => u.plan === 'enterprise').length,
      },
      admins: users.filter(u => ['admin', 'super_admin'].includes(u.role)).length,
    };
    res.json({ success: true, stats });
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Suspend / unsuspend user (admin only)
router.put('/admin/users/:userId/suspend', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const { data: { user } } = await supabaseAdmin.auth.getUser(token);
    const { data: profile } = await supabaseAdmin.from('profiles').select('role').eq('id', user.id).single();
    if (!['admin', 'super_admin'].includes(profile?.role)) {
      return res.status(403).json({ success: false, error: 'Admin access required' });
    }
    if (req.params.userId === user.id) {
      return res.status(400).json({ success: false, error: 'Cannot suspend your own account' });
    }
    const { suspend } = req.body;
    const plan_status = suspend ? 'suspended' : 'active';
    const { error } = await supabaseAdmin
      .from('profiles')
      .update({ plan_status, updated_at: new Date().toISOString() })
      .eq('id', req.params.userId);
    if (error) throw error;
    res.json({ success: true, message: suspend ? 'Account suspended.' : 'Account restored.' });
  } catch (error) {
    console.error('Suspend error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
