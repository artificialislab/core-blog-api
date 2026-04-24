import { Router } from 'express';
import {
  verifyPassword,
  signToken,
  setSessionCookie,
  clearSessionCookie,
  requireAuth,
} from '../auth.js';
import { asyncHandler } from '../http.js';
import { loginRateLimit } from '../rateLimit.js';

const router = Router();

router.post('/login', loginRateLimit, asyncHandler(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'email_and_password_required' });
  }
  const user = await verifyPassword(email, password);
  if (!user) {
    // Mensagem genérica — não vaza se o email existe ou não.
    return res.status(401).json({ error: 'invalid_credentials' });
  }
  const token = signToken(user);
  setSessionCookie(res, token);
  res.json({ user, token });
}));

router.post('/logout', (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: { id: req.user.sub, email: req.user.email, name: req.user.name, role: req.user.role } });
});

export default router;
