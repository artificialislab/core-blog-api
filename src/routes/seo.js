/**
 * Rota de operação do gerador de SEO.
 *
 * Existe por dois motivos:
 *  - depois de um deploy do site (index.html novo) o container da API não
 *    reinicia; o CI chama este endpoint para regerar imediatamente em vez de
 *    esperar a varredura periódica;
 *  - dá um jeito de inspecionar o estado sem entrar na VPS.
 */

import { Router } from 'express';

import { requireAuth, requireRole } from '../auth.js';
import { asyncHandler } from '../http.js';
import { getSiteDir, isSeoEnabled, loadSeoConfig } from '../seo/config.js';
import { refreshSeoNow } from '../seo/refresh.js';

const router = Router();

router.get('/status', requireAuth, requireRole('admin', 'editor'), asyncHandler(async (_req, res) => {
  const config = await loadSeoConfig().catch((err) => ({ error: err.message }));
  res.json({
    enabled: isSeoEnabled(),
    siteDir: getSiteDir(),
    config: config?.error ? { error: config.error } : { siteUrl: config?.siteUrl, blogPath: config?.blog?.path, staticRoutes: config?.staticRoutes?.length ?? 0 },
  });
}));

router.post('/refresh', requireAuth, requireRole('admin', 'editor'), asyncHandler(async (_req, res) => {
  res.json(await refreshSeoNow('manual'));
}));

export default router;
