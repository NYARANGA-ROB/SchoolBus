import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function upsertUser({ email, password, role }) {
  const passwordHash = await bcrypt.hash(password, 10);
  return prisma.user.upsert({
    where: { email },
    update: { role, passwordHash },
    create: {
      email,
      passwordHash,
      role,
      driverProfile: role === 'DRIVER' ? { create: {} } : undefined,
      parentProfile: role === 'PARENT' ? { create: {} } : undefined,
    },
  });
}

async function main() {
  const admin = await upsertUser({ email: 'admin@school.local', password: 'admin123', role: 'ADMIN' });
  const driver = await upsertUser({ email: 'driver@school.local', password: 'driver123', role: 'DRIVER' });
  const parent = await upsertUser({ email: 'parent@school.local', password: 'parent123', role: 'PARENT' });

  const route = await prisma.route.upsert({
    where: { id: 'demo-route' },
    update: { name: 'Demo Route' },
    create: { id: 'demo-route', name: 'Demo Route' },
  });

  const p1 = await prisma.pickupPoint.upsert({
    where: { id: 'pickup-1' },
    update: { name: 'Pickup A', lat: 24.7136, lng: 46.6753, order: 0, routeId: route.id },
    create: { id: 'pickup-1', name: 'Pickup A', lat: 24.7136, lng: 46.6753, order: 0, routeId: route.id },
  });

  const p2 = await prisma.pickupPoint.upsert({
    where: { id: 'pickup-2' },
    update: { name: 'Pickup B', lat: 24.7743, lng: 46.7386, order: 1, routeId: route.id },
    create: { id: 'pickup-2', name: 'Pickup B', lat: 24.7743, lng: 46.7386, order: 1, routeId: route.id },
  });

  const bus = await prisma.bus.upsert({
    where: { code: 'BUS-001' },
    update: { routeId: route.id },
    create: { code: 'BUS-001', routeId: route.id },
  });

  await prisma.driverProfile.update({
    where: { userId: driver.id },
    data: { busId: bus.id },
  });

  const parentProfile = await prisma.parentProfile.findUnique({ where: { userId: parent.id } });

  await prisma.student.upsert({
    where: { id: 'student-1' },
    update: {
      name: 'Mary',
      parentId: parentProfile.id,
      busId: bus.id,
      pickupPointId: p1.id,
    },
    create: {
      id: 'student-1',
      name: 'Mary',
      parentId: parentProfile.id,
      busId: bus.id,
      pickupPointId: p1.id,
    },
  });

  await prisma.student.upsert({
    where: { id: 'student-2' },
    update: {
      name: 'John',
      parentId: parentProfile.id,
      busId: bus.id,
      pickupPointId: p2.id,
    },
    create: {
      id: 'student-2',
      name: 'John',
      parentId: parentProfile.id,
      busId: bus.id,
      pickupPointId: p2.id,
    },
  });

  console.log('Seed complete');
  console.log('Demo credentials:');
  console.log(' admin@school.local / admin123');
  console.log(' driver@school.local / driver123');
  console.log(' parent@school.local / parent123');
  console.log('Student IDs: student-1, student-2');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
