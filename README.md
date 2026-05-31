# TaskNest Backend

Express + Prisma REST API for TaskNest.

## Prerequisites

- Node.js 20+
- PostgreSQL 16+ (or use Docker Compose from the repo root)

## Quick start

### 1. Start PostgreSQL

From the repo root:

```bash
docker compose up -d
```

### 2. Configure environment

```bash
cd tasknest-backend
cp .env.example .env
```

The default `.env.example` works with the Docker Compose database:

```
DATABASE_URL="postgresql://tasknest:tasknest@localhost:5321/tasknest"
PORT=3000
FRONTEND_URL=http://localhost:5173
NODE_ENV=development
```

### 3. Install and initialize the database

```bash
npm install
npm run db:generate
npm run db:push
npm run db:seed
```

### 4. Run the API

```bash
npm run dev
```

API: `http://localhost:3000`  
Health: `GET /health`

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start dev server with hot reload |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run compiled production build |
| `npm run db:generate` | Generate Prisma client |
| `npm run db:push` | Sync schema to database (dev) |
| `npm run db:migrate` | Create/run migrations |
| `npm run db:seed` | Seed demo data |
| `npm run db:studio` | Open Prisma Studio |

## API overview

| Prefix | Description |
|--------|-------------|
| `/health` | Service + database health check |
| `/api/tasks` | Task CRUD, views, search, trash |
| `/api/lists` | Lists + folders |
| `/api/sections` | List sections |
| `/api/tags` | Tags |

## Frontend integration

The Vite dev server proxies `/api` → `http://localhost:3000`. Run both:

```bash
# Terminal 1
cd tasknest-backend && npm run dev

# Terminal 2
cd tasknest-frontend && npm run dev
```
