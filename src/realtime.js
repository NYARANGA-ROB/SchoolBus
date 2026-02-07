import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';

export function createSocketServer(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('unauthorized'));
    try {
      const secret = process.env.JWT_SECRET;
      if (!secret) throw new Error('JWT_SECRET is not set');
      const payload = jwt.verify(token, secret);
      socket.user = { id: payload.sub, role: payload.role };
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    socket.join(`user:${socket.user.id}`);

    socket.on('subscribeBus', (busId) => {
      if (typeof busId !== 'string' || busId.length < 3) return;
      socket.join(`bus:${busId}`);
    });

    socket.on('unsubscribeBus', (busId) => {
      if (typeof busId !== 'string' || busId.length < 3) return;
      socket.leave(`bus:${busId}`);
    });
  });

  return io;
}
