# GoDiet Backend API

Backend Node.js + Express untuk aplikasi GO DIET.

## Endpoints
- `GET  /api/health` — Cek status server
- `POST /api/auth/register` — Registrasi user baru
- `POST /api/auth/login` — Login user
- `PUT  /api/user/profile/:id_user` — Update profil user

## Cara Jalankan Lokal
```bash
npm install
npm start
```

## Environment Variables (Railway)
| Variable | Keterangan |
|---|---|
| `MYSQLHOST` | Host MySQL dari Railway |
| `MYSQLPORT` | Port MySQL dari Railway |
| `MYSQLUSER` | Username MySQL |
| `MYSQLPASSWORD` | Password MySQL |
| `MYSQLDATABASE` | Nama database |
| `PORT` | Port server (otomatis dari Railway) |
