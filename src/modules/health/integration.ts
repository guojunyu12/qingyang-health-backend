import type { Request, Response } from 'express';
import type { HealthDependencies } from './service.js';
import { HealthService } from './service.js';
import { HealthHttpAdapter } from './http.js';
import { HealthError } from './errors.js';
import { HealthInputError } from './validation.js';
import { HealthRepository } from './repository.js';
import { modulePorts, sqlTx, unitOfWorkPort } from '../../common/ports.js';
import { idempotent } from '../../common/foundation.js';
import { ApiFailure, reject } from '../../common/error.js';
import { equal } from '../identity/crypto.js';
import type { IdentityService } from '../identity/service.js';
import { randomUUID } from 'node:crypto';

/** Real module ports are registered once by the application, never by request input. */
export const healthQueryPort = new HealthRepository();
export async function healthResources(req: Request, res: Response, identity: IdentityService) {
  if (!/^\/me\/(dashboard|health\/overview|health-profile|(?:water|weight)-records(?:\/[^/]+)?)$/.test(req.path)) return null;
  const session = await identity.session(req.cookies.qy_access ?? '');
  if (req.method !== 'GET' && !equal(String(req.headers['x-csrf-token'] ?? ''), identity.csrf(session.session_id))) reject(403,'INVALID_CSRF','安全校验失败，请刷新后重试');
  const deps: HealthDependencies = { ...modulePorts, uow: unitOfWorkPort, now: () => new Date() };
  const service = new HealthService(deps);
  const http = new HealthHttpAdapter(service, {
    execute: (request, status, run) => idempotent(session.id, req.method, request.path, req.headers['idempotency-key'], req.body ?? {}, async (connection, ctx) => {
      try { return await run(sqlTx(connection), { ...ctx, requestId:request.requestId }); }
      catch(error) {
        if (error instanceof HealthError || error instanceof HealthInputError) throw new ApiFailure(error.status,error.code,error.message);
        throw error;
      }
    }, status),
  });
  const reply = await http.handle({ method:req.method, path:'/api/v1'+req.path, body:req.body, query:req.query, params:{}, headers:Object.fromEntries(Object.entries(req.headers).map(([k,v])=>[k,Array.isArray(v)?v[0]:v])), identity:{userId:session.id}, requestId:randomUUID() });
  if (reply.status === 204) res.status(204).end(); else res.status(reply.status).json(reply.body);
  return {status:reply.status, raw:true as const};
}
