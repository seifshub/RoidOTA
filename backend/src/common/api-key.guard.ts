import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { createHash, timingSafeEqual } from 'crypto';
import type { Request } from 'express';

export const IS_PUBLIC_KEY = 'isPublic';
/** Marks a route as reachable without an API key (health checks). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

const digest = (value: string) => createHash('sha256').update(value).digest();

/**
 * Global guard. When API_KEY is configured, requests must carry it either as
 * `X-API-Key: <key>` or `Authorization: Bearer <key>`. When it is not
 * configured (development only) every request is allowed.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly config: ConfigService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.get<string>('apiKey');
    if (!expected) return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const provided = this.extractKey(request);
    // Compare digests so the comparison is constant time for any input length.
    if (!provided || !timingSafeEqual(digest(provided), digest(expected))) {
      throw new UnauthorizedException('Missing or invalid API key');
    }
    return true;
  }

  private extractKey(request: Request): string | undefined {
    const header = request.headers['x-api-key'];
    if (typeof header === 'string' && header) return header;

    const authorization = request.headers.authorization;
    if (authorization?.startsWith('Bearer ')) {
      return authorization.slice('Bearer '.length).trim() || undefined;
    }
    return undefined;
  }
}
