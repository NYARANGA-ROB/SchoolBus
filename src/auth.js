import jwt from 'jsonwebtoken';

export function signToken(user) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not set');
  return jwt.sign({ sub: user.id, role: user.role }, secret, { expiresIn: '7d' });
}

export function requireAuth(allowedRoles = null) {
  return (req, res, next) => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = header.slice('Bearer '.length);
    try {
      const secret = process.env.JWT_SECRET;
      if (!secret) throw new Error('JWT_SECRET is not set');
      const payload = jwt.verify(token, secret);
      req.user = { id: payload.sub, role: payload.role };

      if (Array.isArray(allowedRoles) && allowedRoles.length > 0) {
        if (!allowedRoles.includes(req.user.role)) {
          return res.status(403).json({ error: 'Forbidden' });
        }
      }

      next();
    } catch {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  };
}
