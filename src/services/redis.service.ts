import Redis from 'ioredis';
import { config } from '../config';

class RedisService {
  private client: Redis | null = null;
  public isConnected: boolean = false;
  private memoryStore: Map<string, { count: number; expiresAt: number }> = new Map();

  constructor() {
    this.init();
  }

  private init() {
    try {
      this.client = new Redis(config.redisUrl, {
        maxRetriesPerRequest: 1,
        retryStrategy: (times) => {
          if (times > 3) {
            return null; // Stop retrying and fallback to in-memory store
          }
          return Math.min(times * 100, 2000);
        },
        enableOfflineQueue: false,
        lazyConnect: true,
      });

      this.client.connect().then(() => {
        this.isConnected = true;
        console.log('[Redis] Connected to Redis cluster/instance at', config.redisUrl);
      }).catch((err) => {
        this.isConnected = false;
        console.warn('[Redis] Standalone Redis not available. Running with robust in-memory rate-limiting fallback.');
      });

      this.client.on('error', (err) => {
        this.isConnected = false;
      });

      this.client.on('connect', () => {
        this.isConnected = true;
      });
    } catch (e) {
      this.isConnected = false;
      console.warn('[Redis] Initialization error, falling back to in-memory store:', e);
    }
  }

  /**
   * Rate limiting sliding window increment
   * Returns current count in the window
   */
  async incrementRateLimit(key: string, windowSeconds: number): Promise<{ count: number; ttl: number }> {
    if (this.isConnected && this.client) {
      try {
        const fullKey = `rl:${key}`;
        const count = await this.client.incr(fullKey);
        if (count === 1) {
          await this.client.expire(fullKey, windowSeconds);
        }
        const ttl = await this.client.ttl(fullKey);
        return { count, ttl: Math.max(ttl, 0) };
      } catch (err) {
        // Fall back to memory
        return this.incrementMemory(key, windowSeconds);
      }
    }
    return this.incrementMemory(key, windowSeconds);
  }

  private incrementMemory(key: string, windowSeconds: number): { count: number; ttl: number } {
    const now = Date.now();
    const existing = this.memoryStore.get(key);

    if (existing && existing.expiresAt > now) {
      existing.count += 1;
      const ttl = Math.ceil((existing.expiresAt - now) / 1000);
      return { count: existing.count, ttl };
    }

    const expiresAt = now + windowSeconds * 1000;
    this.memoryStore.set(key, { count: 1, expiresAt });
    return { count: 1, ttl: windowSeconds };
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (this.isConnected && this.client) {
      try {
        if (ttlSeconds) {
          await this.client.set(key, value, 'EX', ttlSeconds);
        } else {
          await this.client.set(key, value);
        }
        return;
      } catch (e) {
        // fallback to memory
      }
    }
    this.memoryStore.set(key, { count: 0, expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : Infinity });
  }

  async get(key: string): Promise<string | null> {
    if (this.isConnected && this.client) {
      try {
        return await this.client.get(key);
      } catch (e) {
        // fallback
      }
    }
    return null;
  }
}

export const redisService = new RedisService();

