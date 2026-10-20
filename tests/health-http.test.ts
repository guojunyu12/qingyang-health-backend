import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HealthHttpAdapter } from '../src/modules/health/http.js';
import { ApiFailure } from '../src/common/error.js';
import type { HealthService } from '../src/modules/health/service.js';
test('M01 idempotency errors retain status/code; arbitrary exceptions are private', async () => {
  const service = { deps: { now: () => new Date() } } as HealthService;
  const request = { method:'POST', path:'/api/v1/me/water-records', query:{}, params:{}, headers:{}, identity:{userId:'test'}, requestId:'test', body:{amountMl:250} };
  for (const [error,status,code] of [[new ApiFailure(409,'IDEMPOTENCY_CONFLICT','同一请求标识对应了不同内容'),409,'IDEMPOTENCY_CONFLICT'],[Object.assign(new Error('secret database info'),{fields:{internal:'secret database details'}}),500,'INTERNAL_ERROR']] as const) {
    const http = new HealthHttpAdapter(service, { execute:async () => { throw error; } });
    const reply = await http.handle(request);
    assert.equal(reply.status,status);
    assert.equal((reply.body as any).error.code,code);
    assert.ok(!JSON.stringify(reply.body).includes('secret database'));
  }
});
