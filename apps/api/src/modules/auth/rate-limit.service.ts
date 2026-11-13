import { HttpException, HttpStatus, Injectable, Logger, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import Redis from 'ioredis';
import { createHmac } from 'node:crypto';
import { localDirectEmail } from '../mail/email-delivery-mode';

type Dimension = 'ip' | 'email' | 'user';
type Limit = Partial<Record<Dimension, { max: number; windowMs: number }>>;
type Values = Partial<Record<Dimension, string | undefined>>;
const INCREMENT_IF_ALL_ALLOWED = `
for i = 1, #KEYS do
  local current = tonumber(redis.call('GET', KEYS[i]) or '0')
  local limit = tonumber(ARGV[(i - 1) * 2 + 1])
  if current >= limit then return 0 end
end
for i = 1, #KEYS do
  local count = redis.call('INCR', KEYS[i])
  if count == 1 then redis.call('PEXPIRE', KEYS[i], tonumber(ARGV[(i - 1) * 2 + 2])) end
end
return 1`;
const rateLimited = (retryAfterSeconds: number) => new HttpException({ code: 'RATE_LIMITED', message: 'Слишком много запросов. Повторите попытку после указанной паузы.', retryAfterSeconds }, HttpStatus.TOO_MANY_REQUESTS);

@Injectable()
export class RateLimitService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RateLimitService.name);
  private redis?: Redis;
  private readonly local = new Map<string, { count: number; expiresAt: number }>();

  async onModuleInit() {
    // A stale local REDIS_URL must not prevent SMTP-only development.
    if (localDirectEmail()) return;
    if (process.env.RATE_LIMIT_STORE === 'memory') {
      if (process.env.NODE_ENV === 'production') this.logger.warn('Using process-local production rate limits; counters reset on restart and are not shared between instances');
      return;
    }
    if (process.env.RATE_LIMIT_STORE && process.env.RATE_LIMIT_STORE !== 'redis') throw new Error('RATE_LIMIT_STORE must be redis or memory');
    const url = process.env.REDIS_URL;
    if (!url) {
      if (process.env.NODE_ENV === 'production') throw new Error('REDIS_URL is required for distributed auth rate limiting');
      return;
    }
    this.redis = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 5_000, enableOfflineQueue: false });
    await this.redis.connect();
    await this.redis.ping();
  }

  async onModuleDestroy() { await this.redis?.quit(); }

  async consume(operation: string, values: Values, limits: Limit) {
    const pepper = process.env.EMAIL_CODE_PEPPER;
    if (!pepper) throw new ServiceUnavailableException('Rate limit key is not configured');
    const now = Date.now();
    const entries = (Object.entries(limits) as [Dimension, { max: number; windowMs: number }][])
      .filter(([dimension]) => values[dimension])
      .map(([dimension, rule]) => {
        const windowId = Math.floor(now / rule.windowMs);
        const digest = createHmac('sha256', pepper).update(`${dimension}:${values[dimension]}`).digest('hex');
        return { key: `gloomi:rate:${operation}:${dimension}:${digest}:${windowId}`, rule };
      });
    if (this.redis) {
      try {
        const args = entries.flatMap(({ rule }) => [rule.max, rule.windowMs]);
        const allowed = await this.redis.eval(INCREMENT_IF_ALL_ALLOWED, entries.length, ...entries.map(entry => entry.key), ...args.map(String));
        if (Number(allowed) !== 1) throw rateLimited(Math.max(1, ...entries.map(({ rule }) => Math.ceil(rule.windowMs / 1000))));
        return;
      } catch (error) {
        if (error instanceof HttpException && error.getStatus() === HttpStatus.TOO_MANY_REQUESTS) throw error;
        throw new ServiceUnavailableException('Rate limit service is temporarily unavailable');
      }
    }
    if (process.env.NODE_ENV === 'production' && process.env.RATE_LIMIT_STORE !== 'memory') throw new ServiceUnavailableException('Rate limit service is not configured');
    for (const { key, rule } of entries) {
      const bucket = this.local.get(key);
      if (bucket && bucket.expiresAt > now && bucket.count >= rule.max) throw rateLimited(Math.max(1, Math.ceil((bucket.expiresAt - now) / 1000)));
    }
    for (const { key, rule } of entries) {
      const bucket = this.local.get(key);
      if (!bucket || bucket.expiresAt <= now) this.local.set(key, { count: 1, expiresAt: now + rule.windowMs });
      else bucket.count += 1;
    }
    if (this.local.size > 10_000) for (const [key, bucket] of this.local) if (bucket.expiresAt <= now) this.local.delete(key);
  }
}
