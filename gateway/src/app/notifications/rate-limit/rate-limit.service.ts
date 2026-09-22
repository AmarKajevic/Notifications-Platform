import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

import { RedisService } from '@org/redis';

@Injectable()
export class RateLimitService {
  private readonly limit = 100;
  private readonly windowSeconds = 60;

  constructor(private readonly redis: RedisService) {}

  async check(tenantId: string): Promise<void> {
    const window = Math.floor(Date.now() / 60_000);

    const key = `rate-limit:${tenantId}:${window}`;

    const count = await this.redis.increment(key);

    if (count === 1) {
      await this.redis.expire(key, this.windowSeconds);
    }

    if (count > this.limit) {
      throw new HttpException(
        'Rate limit exceeded',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}
