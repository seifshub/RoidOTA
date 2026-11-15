import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { ApiKeyGuard } from './api-key.guard';

const contextWith = (headers: Record<string, string>) =>
  ({
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  }) as unknown as ExecutionContext;

const guardFor = (apiKey: string | undefined, isPublic = false) =>
  new ApiKeyGuard(
    { get: () => apiKey } as unknown as ConfigService,
    { getAllAndOverride: () => isPublic } as unknown as Reflector,
  );

describe('ApiKeyGuard', () => {
  const key = 'a-sufficiently-long-key';

  it('allows everything when no key is configured', () => {
    expect(guardFor(undefined).canActivate(contextWith({}))).toBe(true);
  });

  it('allows public routes without a key', () => {
    expect(guardFor(key, true).canActivate(contextWith({}))).toBe(true);
  });

  it('accepts the key from either header', () => {
    const guard = guardFor(key);
    expect(guard.canActivate(contextWith({ 'x-api-key': key }))).toBe(true);
    expect(
      guard.canActivate(contextWith({ authorization: `Bearer ${key}` })),
    ).toBe(true);
  });

  it('rejects missing, wrong and prefix-matching keys', () => {
    const guard = guardFor(key);
    const attempts: Record<string, string>[] = [
      {},
      { 'x-api-key': 'wrong' },
      { 'x-api-key': key.slice(0, -1) },
      { authorization: `Basic ${key}` },
      { authorization: 'Bearer ' },
    ];
    for (const headers of attempts) {
      expect(() => guard.canActivate(contextWith(headers))).toThrow(
        UnauthorizedException,
      );
    }
  });
});
