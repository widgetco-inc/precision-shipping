import { Request, Response, NextFunction } from 'express';

// Session-based auth: check req.session.userEmail
export function requireApprovedAdmin(req: Request, res: Response, next: NextFunction) {
  const session = (req as any).session;
  if (session?.userEmail) {
    res.locals.admin = { email: session.userEmail };
    return next();
  }
  res.redirect('/login');
}
