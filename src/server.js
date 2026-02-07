import 'dotenv/config';
import http from 'http';
import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
 import path from 'path';
 import { fileURLToPath } from 'url';

import { prisma } from './prisma.js';
import { signToken, requireAuth } from './auth.js';
import { createSocketServer } from './realtime.js';
import { haversineMeters } from './geo.js';
import { createAndEmitNotification } from './notify.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(path.join(__dirname, '..', 'public')));

const server = http.createServer(app);
const io = createSocketServer(server);

app.get('/health', (req, res) => res.json({ ok: true }));

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  role: z.enum(['ADMIN', 'DRIVER', 'PARENT']),
});

app.post('/auth/register', async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input' });

  const { email, password, role } = parsed.data;
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return res.status(409).json({ error: 'Email already in use' });

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      role,
      driverProfile: role === 'DRIVER' ? { create: {} } : undefined,
      parentProfile: role === 'PARENT' ? { create: {} } : undefined,
    },
  });

  const token = signToken(user);
  return res.json({ token, user: { id: user.id, email: user.email, role: user.role } });
});

const loginSchema = z.object({ email: z.string().email(), password: z.string() });

app.post('/auth/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input' });

  const { email, password } = parsed.data;
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

  const token = signToken(user);
  return res.json({ token, user: { id: user.id, email: user.email, role: user.role } });
});

app.get('/me', requireAuth(), async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: { id: true, email: true, role: true },
  });
  res.json({ user });
});

const adminCreateRouteSchema = z.object({ name: z.string().min(1) });
app.post('/admin/routes', requireAuth(['ADMIN']), async (req, res) => {
  const parsed = adminCreateRouteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input' });
  const route = await prisma.route.create({ data: { name: parsed.data.name } });
  res.json({ route });
});

const adminCreatePickupSchema = z.object({
  routeId: z.string().min(3),
  name: z.string().min(1),
  lat: z.number(),
  lng: z.number(),
  order: z.number().int().min(0),
});
app.post('/admin/pickup-points', requireAuth(['ADMIN']), async (req, res) => {
  const parsed = adminCreatePickupSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input' });
  const point = await prisma.pickupPoint.create({ data: parsed.data });
  res.json({ point });
});

const adminCreateBusSchema = z.object({ code: z.string().min(1), routeId: z.string().min(3).optional() });
app.post('/admin/buses', requireAuth(['ADMIN']), async (req, res) => {
  const parsed = adminCreateBusSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input' });
  const bus = await prisma.bus.create({ data: { code: parsed.data.code, routeId: parsed.data.routeId } });
  res.json({ bus });
});

const adminAssignDriverSchema = z.object({ driverUserId: z.string().min(3), busId: z.string().min(3) });
app.post('/admin/assign-driver', requireAuth(['ADMIN']), async (req, res) => {
  const parsed = adminAssignDriverSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input' });

  const driver = await prisma.driverProfile.findUnique({ where: { userId: parsed.data.driverUserId } });
  if (!driver) return res.status(404).json({ error: 'Driver not found' });

  const updated = await prisma.driverProfile.update({
    where: { id: driver.id },
    data: { busId: parsed.data.busId },
  });

  res.json({ driverProfile: updated });
});

const adminCreateStudentSchema = z.object({
  name: z.string().min(1),
  parentUserId: z.string().min(3),
  busId: z.string().min(3),
  pickupPointId: z.string().min(3),
});
app.post('/admin/students', requireAuth(['ADMIN']), async (req, res) => {
  const parsed = adminCreateStudentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input' });

  const parent = await prisma.parentProfile.findUnique({ where: { userId: parsed.data.parentUserId } });
  if (!parent) return res.status(404).json({ error: 'Parent not found' });

  const student = await prisma.student.create({
    data: {
      name: parsed.data.name,
      parentId: parent.id,
      busId: parsed.data.busId,
      pickupPointId: parsed.data.pickupPointId,
    },
  });

  res.json({ student });
});

app.get('/admin/overview', requireAuth(['ADMIN']), async (req, res) => {
  const buses = await prisma.bus.findMany({
    include: {
      route: true,
      driver: { include: { user: { select: { email: true, id: true } } } },
    },
  });

  res.json({ buses });
});

const driverLocationSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  speedKph: z.number().optional(),
  heading: z.number().optional(),
  accuracyM: z.number().optional(),
  timestamp: z.string().datetime().optional(),
});

app.post('/driver/location', requireAuth(['DRIVER']), async (req, res) => {
  const parsed = driverLocationSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input' });

  const driver = await prisma.driverProfile.findUnique({ where: { userId: req.user.id } });
  if (!driver?.busId) return res.status(400).json({ error: 'Driver has no assigned bus' });

  const busId = driver.busId;
  const loc = await prisma.busLocation.create({
    data: {
      busId,
      lat: parsed.data.lat,
      lng: parsed.data.lng,
      speedKph: parsed.data.speedKph,
      heading: parsed.data.heading,
      accuracyM: parsed.data.accuracyM,
    },
  });

  io.to(`bus:${busId}`).emit('busLocation', {
    busId,
    lat: loc.lat,
    lng: loc.lng,
    speedKph: loc.speedKph,
    heading: loc.heading,
    accuracyM: loc.accuracyM,
    createdAt: loc.createdAt,
  });

  const students = await prisma.student.findMany({
    where: { busId },
    include: {
      pickupPoint: true,
      parent: { include: { user: true } },
    },
  });

  for (const s of students) {
    const dist = haversineMeters({ lat: loc.lat, lng: loc.lng }, { lat: s.pickupPoint.lat, lng: s.pickupPoint.lng });

    if (dist <= 200) {
      await createAndEmitNotification({
        io,
        userId: s.parent.userId,
        type: 'BUS_ARRIVED',
        title: 'Bus arrived',
        body: `${s.name}'s bus has arrived near ${s.pickupPoint.name}.`,
        meta: { busId, studentId: s.id, pickupPointId: s.pickupPointId, distanceM: Math.round(dist) },
        dedupeKey: `arrived:${s.pickupPointId}`,
      });
    } else if (dist <= 1000) {
      await createAndEmitNotification({
        io,
        userId: s.parent.userId,
        type: 'BUS_NEAR_PICKUP',
        title: 'Bus is near pickup',
        body: `${s.name}'s bus is about ${Math.round(dist)}m from ${s.pickupPoint.name}.`,
        meta: { busId, studentId: s.id, pickupPointId: s.pickupPointId, distanceM: Math.round(dist) },
        dedupeKey: `near:${s.pickupPointId}`,
      });
    }
  }

  res.json({ ok: true });
});

const driverAttendanceSchema = z.object({ studentId: z.string().min(3), type: z.enum(['BOARDED', 'DROPPED_OFF']) });
app.post('/driver/attendance', requireAuth(['DRIVER']), async (req, res) => {
  const parsed = driverAttendanceSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input' });

  const driver = await prisma.driverProfile.findUnique({ where: { userId: req.user.id } });
  if (!driver?.busId) return res.status(400).json({ error: 'Driver has no assigned bus' });

  const student = await prisma.student.findUnique({
    where: { id: parsed.data.studentId },
    include: { parent: true },
  });

  if (!student || student.busId !== driver.busId) return res.status(404).json({ error: 'Student not found on this bus' });

  const event = await prisma.attendanceEvent.create({
    data: { studentId: student.id, busId: driver.busId, type: parsed.data.type },
  });

  if (parsed.data.type === 'BOARDED') {
    await createAndEmitNotification({
      io,
      userId: student.parent.userId,
      type: 'STUDENT_BOARDED',
      title: 'Student boarded',
      body: `${student.name} boarded the bus.`,
      meta: { studentId: student.id, busId: driver.busId, attendanceId: event.id },
      dedupeKey: `boarded:${student.id}`,
    });
  }

  io.to(`bus:${driver.busId}`).emit('attendance', {
    id: event.id,
    busId: driver.busId,
    studentId: student.id,
    type: event.type,
    createdAt: event.createdAt,
  });

  res.json({ event });
});

app.get('/parent/students', requireAuth(['PARENT']), async (req, res) => {
  const parent = await prisma.parentProfile.findUnique({
    where: { userId: req.user.id },
    include: { students: { include: { bus: true, pickupPoint: true } } },
  });
  if (!parent) return res.status(404).json({ error: 'Parent not found' });
  res.json({ students: parent.students });
});

app.get('/bus/:busId/latest-location', requireAuth(), async (req, res) => {
  const busId = req.params.busId;
  const loc = await prisma.busLocation.findFirst({ where: { busId }, orderBy: { createdAt: 'desc' } });
  res.json({ location: loc });
});

app.get('/notifications', requireAuth(), async (req, res) => {
  const items = await prisma.notificationEvent.findMany({
    where: { userId: req.user.id },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  res.json({ notifications: items });
});

const port = Number(process.env.PORT || 3000);
server.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
