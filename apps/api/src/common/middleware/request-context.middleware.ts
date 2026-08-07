import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'crypto';

export interface RequestWithId extends Request {
  requestId: string;
}

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: RequestWithId, res: Response, next: NextFunction) {
    req.requestId = `req_${randomUUID()}`;
    res.setHeader('X-Request-Id', req.requestId);
    next();
  }
}
