# SchoolBus MVP (Real-time GPS-Based School Transport Management)

## What you get

- Express REST API + Socket.IO realtime
- PostgreSQL + Prisma
- Demo web pages:
  - `/admin.html` live bus monitoring
  - `/driver.html` driver simulator (send GPS + attendance)
  - `/parent.html` parent live view + notification events

## Prerequisites

- Node.js 18+
- Docker Desktop (recommended) OR a local PostgreSQL instance

## Setup

1. Create `.env` from `.env.example` (edit if needed)

2. Start PostgreSQL

```bash
docker compose up -d
```

3. Install dependencies

```bash
npm install
```

4. Run migrations + seed demo data

```bash
npm run prisma:migrate
npm run prisma:seed
```

5. Start the server

```bash
npm run dev
```

Open:

- http://localhost:3000/

## Demo accounts

- Admin: `admin@school.local` / `admin123`
- Driver: `driver@school.local` / `driver123`
- Parent: `parent@school.local` / `parent123`

Student IDs for driver attendance:

- `student-1`
- `student-2`

## Key API endpoints

- `POST /auth/register`
- `POST /auth/login`
- `POST /driver/location`
- `POST /driver/attendance`
- `GET /parent/students`
- `GET /notifications`

## Realtime events (Socket.IO)

- Join your user room automatically (based on JWT)
- `subscribeBus(busId)` to receive:
  - `busLocation`
  - `attendance`
- You will also receive `notification` events in real time
