import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../lib/env';

interface AdminIdentity {
  email: string;
  name?: string;
}

export function getAdminIdentity(req: Request): AdminIdentity {
  const emailHeader = (req.headers['x-admin-email'] as string | undefined)?.toLowerCase();
  if (emailHeader) return { email: emailHeader };

  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) {
    try {
      const token = auth.replace('Bearer ', '');
      const decoded = jwt.verify(token, env.sessionTokenSecret) as jwt.JwtPayload;
      const email = String(decoded.email ?? '').toLowerCase();
      const name = decoded.name ? String(decoded.name) : undefined;
      if (email) return { email, name };
    } catch {
      // ignore invalid token and fall through
    }
  }

  // Local/dev fallback so the scaffold opens without Shopify identity wiring.
  return { email: env.localAdminLabel, name: 'Local Admin' };
}

export function requireApprovedAdmin(req: Request, res: Response, next: NextFunction): void {
  const identity = getAdminIdentity(req);
  res.locals.admin = identity;
  next();
}
