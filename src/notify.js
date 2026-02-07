import { prisma } from './prisma.js';

const cooldownMs = 5 * 60 * 1000;
const cooldown = new Map();

function cooldownKey(userId, type, key) {
  return `${userId}:${type}:${key}`;
}

export async function createAndEmitNotification({ io, userId, type, title, body, meta, dedupeKey }) {
  const now = Date.now();
  if (dedupeKey) {
    const k = cooldownKey(userId, type, dedupeKey);
    const last = cooldown.get(k) || 0;
    if (now - last < cooldownMs) return null;
    cooldown.set(k, now);
  }

  const event = await prisma.notificationEvent.create({
    data: { userId, type, title, body, meta },
  });

  io.to(`user:${userId}`).emit('notification', {
    id: event.id,
    type: event.type,
    title: event.title,
    body: event.body,
    meta: event.meta,
    createdAt: event.createdAt,
  });

  return event;
}
