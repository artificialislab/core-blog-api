import rateLimit from 'express-rate-limit';

function createRateLimiter(options) {
  return rateLimit({
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'too_many_requests' },
    ...options,
  });
}

export const loginRateLimit = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
});

export const uploadRateLimit = createRateLimiter({
  windowMs: 60 * 1000,
  limit: 30,
});

export const seedRateLimit = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  limit: 5,
});
