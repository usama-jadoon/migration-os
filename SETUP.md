# MigrationOS Setup

This project is configured to run locally with zero external installations (no Docker, no PostgreSQL, no Redis required).

## Prerequisites
- **Node.js** (v18 or higher) from [nodejs.org](https://nodejs.org/)
- That is all!

---

## Steps to Run

### 1. Run the Backend API Services
Open a terminal in the project root folder and execute the following:

```powershell
cd apps/api
npm install
npx prisma generate
npx prisma migrate dev --name init
npm run dev
```

The API server will start on port **4000** (`http://localhost:4000`).

### 2. Run the Web Dashboard
Open a new terminal in the project root folder and execute the following:

```powershell
cd apps/web
npm install
npm run dev
```

The Web Dashboard will start on port **3000** (or **3001/3002** if 3000 is occupied). You can access it in your browser.

---

## Troubleshooting
- If you face any issues with npm scripts blocking on Windows, run the following in an Administrator PowerShell:
  `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned -Force`
