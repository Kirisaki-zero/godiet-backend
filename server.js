const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors());
app.use(express.json());

// ─────────────────────────────────────────────────────────────────────
// Konfigurasi Database
// Di Railway: otomatis terbaca dari environment variables.
// Di lokal (XAMPP): ubah nilai default di bawah sesuai konfigurasi Anda.
// ─────────────────────────────────────────────────────────────────────
const dbConfig = {
  host:     process.env.MYSQLHOST     || 'localhost',
  port:     process.env.MYSQLPORT     || 3306,
  user:     process.env.MYSQLUSER     || 'root',
  password: process.env.MYSQLPASSWORD || '',
  database: process.env.MYSQLDATABASE || 'godiet_db',
  connectionLimit: 5,         // Batasi jumlah koneksi maksimal agar tidak error 1040
  waitForConnections: true,   // Antre request jika koneksi penuh
  queueLimit: 0,              // Tidak ada batas antrean
  connectTimeout: 10000       // Timeout 10 detik
};

let pool;

async function initDB() {
  try {
    pool = mysql.createPool(dbConfig);
    // Jalankan migrasi: buat tabel jika belum ada
    await runMigrations();
    // Jalankan migrasi ALTER: tambah kolom baru jika belum ada
    await runAlterMigrations();
    console.log("✅ Berhasil terkoneksi ke MySQL Database");
  } catch (err) {
    console.error("❌ Gagal terkoneksi ke MySQL:", err.message);
    // Coba lagi setelah 5 detik (berguna saat startup Railway)
    setTimeout(initDB, 5000);
  }
}

// Buat tabel otomatis jika belum ada (agar tidak perlu import SQL manual)
async function runMigrations() {
  const queries = [
    `CREATE TABLE IF NOT EXISTS users (
      id_user VARCHAR(50) PRIMARY KEY,
      email VARCHAR(100) UNIQUE NOT NULL,
      password VARCHAR(255) NOT NULL,
      role ENUM('admin', 'enduser') NOT NULL DEFAULT 'enduser'
    )`,
    `CREATE TABLE IF NOT EXISTS end_user_profiles (
      id_user VARCHAR(50) PRIMARY KEY,
      nama VARCHAR(100),
      berat_badan FLOAT DEFAULT 0,
      tinggi_badan FLOAT DEFAULT 0,
      usia INT DEFAULT 0,
      jenis_kelamin VARCHAR(20) DEFAULT '',
      tingkat_aktivitas VARCHAR(50) DEFAULT '',
      target_kalori_harian FLOAT DEFAULT 0,
      foto_profil TEXT,
      FOREIGN KEY (id_user) REFERENCES users(id_user) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS foods (
      id_makanan VARCHAR(50) PRIMARY KEY,
      nama_makanan VARCHAR(100) NOT NULL,
      kalori FLOAT,
      protein FLOAT,
      lemak FLOAT,
      karbohidrat FLOAT,
      resep TEXT,
      kategori VARCHAR(50)
    )`,
    `CREATE TABLE IF NOT EXISTS histories (
      id_history VARCHAR(50) PRIMARY KEY,
      id_user VARCHAR(50),
      tanggal_akses DATE,
      FOREIGN KEY (id_user) REFERENCES users(id_user) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS history_details (
      id_history VARCHAR(50),
      id_makanan VARCHAR(50),
      PRIMARY KEY (id_history, id_makanan),
      FOREIGN KEY (id_history) REFERENCES histories(id_history) ON DELETE CASCADE,
      FOREIGN KEY (id_makanan) REFERENCES foods(id_makanan) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS bookmarks (
      id_bookmark VARCHAR(50) PRIMARY KEY,
      id_user VARCHAR(50),
      tanggal_disimpan DATE,
      FOREIGN KEY (id_user) REFERENCES users(id_user) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS bookmark_details (
      id_bookmark VARCHAR(50),
      id_makanan VARCHAR(50),
      PRIMARY KEY (id_bookmark, id_makanan),
      FOREIGN KEY (id_bookmark) REFERENCES bookmarks(id_bookmark) ON DELETE CASCADE,
      FOREIGN KEY (id_makanan) REFERENCES foods(id_makanan) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS reports (
      id_report VARCHAR(50) PRIMARY KEY,
      id_user VARCHAR(50),
      username VARCHAR(100),
      judul VARCHAR(200),
      isi_laporan TEXT,
      kategori VARCHAR(50) DEFAULT 'Umum',
      status ENUM('pending', 'resolved', 'rejected') DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (id_user) REFERENCES users(id_user) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS workout_histories (
      id_workout VARCHAR(50) PRIMARY KEY,
      id_user VARCHAR(50) NOT NULL,
      tanggal DATE NOT NULL,
      durasi_detik INT DEFAULT 0,
      kalori_terbakar FLOAT DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (id_user) REFERENCES users(id_user) ON DELETE CASCADE
    )`,
  ];

  for (const query of queries) {
    await pool.query(query);
  }
  console.log("✅ Migrasi tabel selesai.");
}

// Tambah kolom baru ke tabel yang sudah ada (aman: error diabaikan jika kolom sudah ada)
async function runAlterMigrations() {
  const alterQueries = [
    `ALTER TABLE users ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`,
    `ALTER TABLE end_user_profiles ADD COLUMN tujuan VARCHAR(200) DEFAULT ''`,
  ];
  for (const q of alterQueries) {
    try {
      await pool.query(q);
    } catch (err) {
      // Kolom sudah ada — abaikan error
    }
  }
  console.log("✅ Migrasi ALTER selesai.");
}

initDB();

// =========================================================
// HEALTH CHECK
// =========================================================
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'GoDiet API' });
});

// =========================================================
// 1. ENDPOINT REGISTRASI
// =========================================================
app.post('/api/auth/register', async (req, res) => {
  const {
    email, password, nama,
    berat_badan, tinggi_badan, usia,
    jenis_kelamin, tingkat_aktivitas, target_kalori_harian, tujuan
  } = req.body;

  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Email dan password wajib diisi!' });
  }

  try {
    const [existing] = await pool.query('SELECT id_user FROM users WHERE email = ?', [email]);
    if (existing.length > 0) {
      return res.status(400).json({ success: false, message: 'Email sudah terdaftar!' });
    }

    const id_user = uuidv4();
    const hashedPassword = await bcrypt.hash(password, 10);

    await pool.query(
      'INSERT INTO users (id_user, email, password, role) VALUES (?, ?, ?, ?)',
      [id_user, email, hashedPassword, 'enduser']
    );

    await pool.query(
      'INSERT INTO end_user_profiles (id_user, nama, berat_badan, tinggi_badan, usia, jenis_kelamin, tingkat_aktivitas, target_kalori_harian, tujuan) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id_user, nama || '', berat_badan || 0, tinggi_badan || 0, usia || 0, jenis_kelamin || '', tingkat_aktivitas || '', target_kalori_harian || 0, tujuan || '']
    );

    res.status(201).json({ success: true, message: 'Registrasi berhasil', id_user });
  } catch (error) {
    console.error("Error Register:", error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan pada server' });
  }
});

// =========================================================
// 2. ENDPOINT LOGIN
// =========================================================
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Email dan password wajib diisi!' });
  }

  try {
    const [users] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
    if (users.length === 0) {
      return res.status(401).json({ success: false, message: 'Email atau password salah' });
    }

    const user = users[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({ success: false, message: 'Email atau password salah' });
    }

    const [profiles] = await pool.query('SELECT * FROM end_user_profiles WHERE id_user = ?', [user.id_user]);

    res.json({
      success: true,
      message: 'Login berhasil',
      user: {
        id_user: user.id_user,
        email: user.email,
        role: user.role,
        profile: profiles.length > 0 ? profiles[0] : null
      }
    });
  } catch (error) {
    console.error("Error Login:", error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan pada server' });
  }
});

// =========================================================
// 3. GET PROFIL USER
// =========================================================
app.get('/api/user/profile/:id_user', async (req, res) => {
  const { id_user } = req.params;
  try {
    const [profiles] = await pool.query('SELECT * FROM end_user_profiles WHERE id_user = ?', [id_user]);
    if (profiles.length === 0) {
      return res.status(404).json({ success: false, message: 'Profil tidak ditemukan' });
    }
    res.json({ success: true, profile: profiles[0] });
  } catch (error) {
    console.error("Error Get Profile:", error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan pada server' });
  }
});

// =========================================================
// 4. UPDATE PROFIL USER
// =========================================================
app.put('/api/user/profile/:id_user', async (req, res) => {
  const { id_user } = req.params;
  const { nama, berat_badan, tinggi_badan, usia, jenis_kelamin, tingkat_aktivitas, target_kalori_harian, foto_profil, tujuan } = req.body;

  try {
    await pool.query(
      'UPDATE end_user_profiles SET nama=?, berat_badan=?, tinggi_badan=?, usia=?, jenis_kelamin=?, tingkat_aktivitas=?, target_kalori_harian=?, foto_profil=?, tujuan=? WHERE id_user=?',
      [nama, berat_badan, tinggi_badan, usia, jenis_kelamin, tingkat_aktivitas, target_kalori_harian, foto_profil || '', tujuan || '', id_user]
    );
    res.json({ success: true, message: 'Profil berhasil diperbarui' });
  } catch (error) {
    console.error("Error Update Profile:", error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan pada server' });
  }
});

// =========================================================
// 5. HAPUS AKUN USER
// =========================================================
app.delete('/api/user/:id_user', async (req, res) => {
  const { id_user } = req.params;

  try {
    // ON DELETE CASCADE di FK akan otomatis menghapus profil, history, dan bookmark
    const [result] = await pool.query('DELETE FROM users WHERE id_user = ?', [id_user]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'User tidak ditemukan' });
    }
    res.json({ success: true, message: 'Akun berhasil dihapus' });
  } catch (error) {
    console.error("Error Delete User:", error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan pada server' });
  }
});

// =========================================================
// ADMIN MIDDLEWARE — verifikasi role admin dari DB
// =========================================================
async function adminOnly(req, res, next) {
  const adminId = req.headers['x-admin-id'];
  if (!adminId) {
    return res.status(401).json({ success: false, message: 'Akses ditolak: Header X-Admin-Id wajib ada.' });
  }
  try {
    const [rows] = await pool.query('SELECT role FROM users WHERE id_user = ?', [adminId]);
    if (rows.length === 0 || rows[0].role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Akses ditolak: Bukan admin.' });
    }
    next();
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Gagal memverifikasi admin.' });
  }
}

// =========================================================
// ADMIN 1. STATISTIK DASBOR
// =========================================================
app.get('/api/admin/stats', adminOnly, async (req, res) => {
  try {
    // 1. Total users & foods
    const [[{ totalUsers }]] = await pool.query('SELECT COUNT(*) AS totalUsers FROM users WHERE role = "enduser"');
    const [[{ totalFoods }]] = await pool.query('SELECT COUNT(*) AS totalFoods FROM foods');

    // 2. User baru bulan ini
    const [[{ newUsersThisMonth }]] = await pool.query(
      'SELECT COUNT(*) AS newUsersThisMonth FROM users WHERE role = "enduser" AND MONTH(created_at) = MONTH(NOW()) AND YEAR(created_at) = YEAR(NOW())'
    );

    // 3. Rata-rata BMI platform
    const [[{ avgBmi }]] = await pool.query(
      'SELECT AVG(berat_badan / (tinggi_badan/100 * tinggi_badan/100)) AS avgBmi FROM end_user_profiles WHERE berat_badan > 0 AND tinggi_badan > 0'
    );

    // 4. Pertumbuhan user — 7 bulan terakhir
    const [growthRows] = await pool.query(`
      SELECT DATE_FORMAT(created_at, '%b') AS name,
             DATE_FORMAT(created_at, '%Y-%m') AS month_key,
             COUNT(*) AS users
      FROM users
      WHERE role = 'enduser' AND created_at >= DATE_SUB(NOW(), INTERVAL 7 MONTH)
      GROUP BY month_key, name
      ORDER BY month_key ASC
    `);

    // 5. Distribusi program diet
    const [dietRows] = await pool.query(`
      SELECT
        CASE
          WHEN tujuan LIKE '%turun%' OR tujuan LIKE '%Fat Loss%' OR tujuan LIKE '%Menurunkan%' THEN 'Fat Loss'
          WHEN tujuan LIKE '%otot%' OR tujuan LIKE '%Muscle%' OR tujuan LIKE '%kuat%' THEN 'Muscle Gain'
          WHEN tujuan LIKE '%bugar%' OR tujuan LIKE '%Tetap%' OR tujuan LIKE '%Maintenance%' THEN 'Maintenance'
          ELSE 'Health'
        END AS name,
        COUNT(*) AS value
      FROM end_user_profiles
      WHERE tujuan IS NOT NULL AND tujuan != ''
      GROUP BY 1
    `);

    // 6. Sesi workout per hari (7 hari terakhir)
    const [weeklyRows] = await pool.query(`
      SELECT DAYNAME(tanggal) AS day_name, COUNT(*) AS sessions
      FROM workout_histories
      WHERE tanggal >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
      GROUP BY DAYOFWEEK(tanggal), DAYNAME(tanggal)
      ORDER BY DAYOFWEEK(tanggal)
    `);

    // 7. Workout hari ini
    const [[{ todayWorkouts }]] = await pool.query(
      'SELECT COUNT(*) AS todayWorkouts FROM workout_histories WHERE tanggal = CURDATE()'
    );

    // 8. Total kalori terbakar minggu ini
    const [[{ weeklyCaloriesBurned }]] = await pool.query(
      'SELECT COALESCE(SUM(kalori_terbakar), 0) AS weeklyCaloriesBurned FROM workout_histories WHERE tanggal >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)'
    );

    // 9. Compliance data — 7 minggu terakhir
    const [complianceRaw] = await pool.query(`
      SELECT
        YEARWEEK(tanggal, 1) AS week_key,
        COUNT(DISTINCT id_user) AS active_users
      FROM workout_histories
      WHERE tanggal >= DATE_SUB(CURDATE(), INTERVAL 7 WEEK)
      GROUP BY week_key
      ORDER BY week_key ASC
      LIMIT 7
    `);
    const complianceData = complianceRaw.map((row, idx) => ({
      name: `W${idx + 1}`,
      rate: Number(totalUsers) > 0 ? Math.round((Number(row.active_users) / Number(totalUsers)) * 100) : 0,
    }));

    // 10. Pantauan kebugaran user (top 10)
    const [fitnessRows] = await pool.query(`
      SELECT u.id_user,
        COALESCE(p.nama, u.email) AS nama,
        COALESCE(p.tujuan, '') AS tujuan,
        MAX(wh.tanggal) AS last_workout,
        COALESCE(DATEDIFF(CURDATE(), MAX(wh.tanggal)), 999) AS days_since_workout
      FROM users u
      LEFT JOIN end_user_profiles p ON u.id_user = p.id_user
      LEFT JOIN workout_histories wh ON u.id_user = wh.id_user
      WHERE u.role = 'enduser'
      GROUP BY u.id_user, p.nama, p.tujuan
      ORDER BY days_since_workout ASC
      LIMIT 10
    `);

    // 11. Laporan pending
    const [[{ pendingReports }]] = await pool.query(
      'SELECT COUNT(*) AS pendingReports FROM reports WHERE status = "pending"'
    );

    // ── Map nama hari ke Bahasa Indonesia ───────────────────────────────
    const dayMap = { Monday: 'Sen', Tuesday: 'Sel', Wednesday: 'Rab', Thursday: 'Kam', Friday: 'Jum', Saturday: 'Sab', Sunday: 'Min' };
    const allDays = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];
    const weeklyMap = {};
    weeklyRows.forEach(r => { weeklyMap[dayMap[r.day_name] || r.day_name] = Number(r.sessions); });
    const weeklyWorkouts = allDays.map(d => ({ name: d, sessions: weeklyMap[d] || 0 }));

    // ── Peta status kebugaran ───────────────────────────────────────────
    const userFitnessOverview = fitnessRows.map((u, i) => {
      const days = Number(u.days_since_workout);
      let status = 'Tidak Aktif';
      if (days <= 2) status = 'On Track';
      else if (days <= 7) status = 'Perlu Perhatian';
      const nameParts = (u.nama || '?').split(' ');
      const initials = nameParts.map(n => (n[0] || '')).join('').substring(0, 2).toUpperCase();
      return {
        id: `#${i + 1}`,
        id_user: u.id_user,
        name: u.nama || '-',
        initials,
        program: u.tujuan || 'Umum',
        streak: u.last_workout ? `${days}d` : '-',
        status,
      };
    });

    // ── Notifikasi dinamis ──────────────────────────────────────────────
    const notifications = [];
    const inactiveCount = userFitnessOverview.filter(u => u.status === 'Tidak Aktif').length;
    const onTrackCount  = userFitnessOverview.filter(u => u.status === 'On Track').length;
    if (inactiveCount > 0)   notifications.push({ type: 'warning', text: `${inactiveCount} user tidak aktif lebih dari 7 hari`, label: 'Peringatan' });
    if (pendingReports > 0)  notifications.push({ type: 'warning', text: `${pendingReports} laporan menunggu penanganan`, label: 'Peringatan' });
    if (onTrackCount > 0)    notifications.push({ type: 'success', text: `${onTrackCount} user aktif latihan minggu ini`, label: 'Pencapaian' });
    if (newUsersThisMonth > 0) notifications.push({ type: 'info', text: `${newUsersThisMonth} user baru bergabung bulan ini`, label: 'Info' });

    res.json({
      success: true,
      totalUsers,
      totalFoods,
      newUsersThisMonth,
      avgBmi: avgBmi ? Math.round(Number(avgBmi) * 10) / 10 : 0,
      userGrowth: growthRows,
      weeklyWorkouts,
      dietDistribution: dietRows,
      complianceData,
      todayWorkouts,
      weeklyCaloriesBurned: Math.round(Number(weeklyCaloriesBurned) || 0),
      userFitnessOverview,
      notifications,
    });
  } catch (error) {
    console.error("Error Admin Stats:", error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan' });
  }
});

// =========================================================
// ADMIN 2. LIHAT SEMUA USER
// =========================================================
app.get('/api/admin/users', adminOnly, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT u.id_user, u.email, u.role, p.nama, p.berat_badan, p.tinggi_badan, p.usia, p.jenis_kelamin, p.tingkat_aktivitas
      FROM users u
      LEFT JOIN end_user_profiles p ON u.id_user = p.id_user
      WHERE u.role = 'enduser'
      ORDER BY u.email ASC
    `);
    res.json({ success: true, users: rows });
  } catch (error) {
    console.error("Error Admin Get Users:", error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan' });
  }
});

// =========================================================
// ADMIN: DATA KEBUGARAN LENGKAP
// =========================================================
app.get('/api/admin/fitness', adminOnly, async (req, res) => {
  try {
    // 1. Total enduser
    const [[{ totalUsers }]] = await pool.query('SELECT COUNT(*) AS totalUsers FROM users WHERE role = "enduser"');

    // 2. Sesi workout per hari (7 hari terakhir) — untuk bar chart
    const [weeklyRows] = await pool.query(`
      SELECT DAYNAME(tanggal) AS day_name, COUNT(*) AS sessions
      FROM workout_histories
      WHERE tanggal >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
      GROUP BY DAYOFWEEK(tanggal), DAYNAME(tanggal)
      ORDER BY DAYOFWEEK(tanggal)
    `);
    const dayMap = { Monday: 'Sen', Tuesday: 'Sel', Wednesday: 'Rab', Thursday: 'Kam', Friday: 'Jum', Saturday: 'Sab', Sunday: 'Min' };
    const allDays = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];
    const weeklyMap = {};
    weeklyRows.forEach(r => { weeklyMap[dayMap[r.day_name] || r.day_name] = Number(r.sessions); });
    const weeklySessionsData = allDays.map(d => ({ name: d, sessions: weeklyMap[d] || 0 }));

    // 3. Compliance trend — 7 minggu terakhir — untuk area chart
    const [complianceRaw] = await pool.query(`
      SELECT
        YEARWEEK(tanggal, 1) AS week_key,
        COUNT(DISTINCT id_user) AS active_users
      FROM workout_histories
      WHERE tanggal >= DATE_SUB(CURDATE(), INTERVAL 7 WEEK)
      GROUP BY week_key
      ORDER BY week_key ASC
      LIMIT 7
    `);
    const complianceTrendData = complianceRaw.map((row, idx) => ({
      name: `W${idx + 1}`,
      rate: Number(totalUsers) > 0 ? Math.round((Number(row.active_users) / Number(totalUsers)) * 100) : 0,
    }));

    // 4. Data per-user lengkap untuk tabel
    const [userRows] = await pool.query(`
      SELECT
        u.id_user,
        u.email,
        COALESCE(p.nama, u.email) AS nama,
        COALESCE(p.berat_badan, 0) AS berat_badan,
        COALESCE(p.tinggi_badan, 0) AS tinggi_badan,
        COALESCE(p.tujuan, '') AS tujuan,
        MAX(wh.tanggal) AS last_workout,
        COALESCE(DATEDIFF(CURDATE(), MAX(wh.tanggal)), 999) AS days_since_workout,
        COUNT(wh.id_workout) AS total_workouts,
        COALESCE(SUM(wh.kalori_terbakar), 0) AS total_kalori
      FROM users u
      LEFT JOIN end_user_profiles p ON u.id_user = p.id_user
      LEFT JOIN workout_histories wh ON u.id_user = wh.id_user
        AND wh.tanggal >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
      WHERE u.role = 'enduser'
      GROUP BY u.id_user, p.nama, p.berat_badan, p.tinggi_badan, p.tujuan
      ORDER BY days_since_workout ASC
    `);

    // Map ke format yang dibutuhkan frontend
    const fitnessUsers = userRows.map((u, i) => {
      const days = Number(u.days_since_workout);
      const bb   = Number(u.berat_badan) || 0;
      const tb   = Number(u.tinggi_badan) || 0;
      const bmi  = (bb > 0 && tb > 0) ? Math.round((bb / ((tb / 100) ** 2)) * 10) / 10 : null;

      // Compliance: rasio hari aktif workout dalam 30 hari (maks 100%)
      const workoutDays30 = Number(u.total_workouts) || 0;
      const compliance = Math.min(Math.round((workoutDays30 / 30) * 100), 100);

      // Status badge
      let status = 'Off';
      if (days <= 2)      status = 'OK';
      else if (days <= 7) status = 'Warn';

      // Label last workout
      let lastWorkout = 'Belum pernah';
      if (u.last_workout) {
        if (days === 0)      lastWorkout = 'Hari ini';
        else if (days === 1) lastWorkout = 'Kemarin';
        else                 lastWorkout = `${days} hari lalu`;
      }

      // Initials
      const nameParts = (u.nama || '?').split(' ');
      const initials  = nameParts.map(n => n[0] || '').join('').substring(0, 2).toUpperCase();

      // Program dari tujuan
      let program = 'Umum';
      const t = (u.tujuan || '').toLowerCase();
      if (t.includes('turun') || t.includes('fat') || t.includes('menurunkan')) program = 'Fat Loss';
      else if (t.includes('otot') || t.includes('muscle') || t.includes('kuat')) program = 'Muscle Gain';
      else if (t.includes('bugar') || t.includes('tetap') || t.includes('maintenance')) program = 'Maintenance';
      else if (u.tujuan && u.tujuan.trim() !== '') program = 'Health';

      return {
        id: `#${i + 1}`,
        id_user: u.id_user,
        name: u.nama || u.email,
        initials,
        program,
        bmi,
        compliance,
        streak: days < 999 ? days : 0,
        status,
        lastWorkout,
        totalKalori: Math.round(Number(u.total_kalori) || 0),
      };
    });

    // 5. Stat cards
    const countOK   = fitnessUsers.filter(u => u.status === 'OK').length;
    const countWarn = fitnessUsers.filter(u => u.status === 'Warn').length;
    const countOff  = fitnessUsers.filter(u => u.status === 'Off').length;
    const avgCompliance = fitnessUsers.length > 0
      ? Math.round(fitnessUsers.reduce((s, u) => s + u.compliance, 0) / fitnessUsers.length)
      : 0;

    res.json({
      success: true,
      totalUserFitness: fitnessUsers.length,
      countOK,
      countWarn,
      countOff,
      avgCompliance,
      weeklySessionsData,
      complianceTrendData,
      fitnessUsers,
    });
  } catch (error) {
    console.error("Error Admin Fitness:", error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan' });
  }
});


// =========================================================
// ADMIN 3. HAPUS USER
// =========================================================
app.delete('/api/admin/users/:id_user', adminOnly, async (req, res) => {
  const { id_user } = req.params;
  try {
    const [result] = await pool.query('DELETE FROM users WHERE id_user = ?', [id_user]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'User tidak ditemukan' });
    }
    res.json({ success: true, message: 'User berhasil dihapus' });
  } catch (error) {
    console.error("Error Admin Delete User:", error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan' });
  }
});

// =========================================================
// ADMIN 4. LIHAT SEMUA MAKANAN
// =========================================================
app.get('/api/admin/foods', adminOnly, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM foods ORDER BY nama_makanan ASC');
    res.json({ success: true, foods: rows });
  } catch (error) {
    console.error("Error Admin Get Foods:", error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan' });
  }
});

// =========================================================
// ADMIN 5. TAMBAH MAKANAN BARU
// =========================================================
app.post('/api/admin/foods', adminOnly, async (req, res) => {
  const { nama_makanan, kalori, protein, lemak, karbohidrat, resep, kategori } = req.body;
  if (!nama_makanan) {
    return res.status(400).json({ success: false, message: 'Nama makanan wajib diisi!' });
  }
  const id_makanan = uuidv4();
  try {
    await pool.query(
      'INSERT INTO foods (id_makanan, nama_makanan, kalori, protein, lemak, karbohidrat, resep, kategori) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [id_makanan, nama_makanan, kalori || 0, protein || 0, lemak || 0, karbohidrat || 0, resep || '', kategori || '']
    );
    res.status(201).json({ success: true, message: 'Makanan berhasil ditambahkan', id_makanan });
  } catch (error) {
    console.error("Error Admin Add Food:", error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan' });
  }
});

// =========================================================
// ADMIN 6. UPDATE MAKANAN
// =========================================================
app.put('/api/admin/foods/:id_makanan', adminOnly, async (req, res) => {
  const { id_makanan } = req.params;
  const { nama_makanan, kalori, protein, lemak, karbohidrat, resep, kategori } = req.body;
  try {
    const [result] = await pool.query(
      'UPDATE foods SET nama_makanan=?, kalori=?, protein=?, lemak=?, karbohidrat=?, resep=?, kategori=? WHERE id_makanan=?',
      [nama_makanan, kalori || 0, protein || 0, lemak || 0, karbohidrat || 0, resep || '', kategori || '', id_makanan]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Makanan tidak ditemukan' });
    }
    res.json({ success: true, message: 'Makanan berhasil diperbarui' });
  } catch (error) {
    console.error("Error Admin Update Food:", error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan' });
  }
});

// =========================================================
// ADMIN 7. HAPUS MAKANAN
// =========================================================
app.delete('/api/admin/foods/:id_makanan', adminOnly, async (req, res) => {
  const { id_makanan } = req.params;
  try {
    const [result] = await pool.query('DELETE FROM foods WHERE id_makanan = ?', [id_makanan]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Makanan tidak ditemukan' });
    }
    res.json({ success: true, message: 'Makanan berhasil dihapus' });
  } catch (error) {
    console.error("Error Admin Delete Food:", error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan' });
  }
});

// =========================================================
// ADMIN 8. LIHAT SEMUA LAPORAN
// =========================================================
app.get('/api/admin/reports', adminOnly, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM reports ORDER BY created_at DESC');
    res.json(rows);
  } catch (error) {
    console.error("Error Admin Get Reports:", error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan' });
  }
});

// =========================================================
// ADMIN 9. HAPUS LAPORAN
// =========================================================
app.delete('/api/admin/reports/:id_report', adminOnly, async (req, res) => {
  const { id_report } = req.params;
  try {
    const [result] = await pool.query('DELETE FROM reports WHERE id_report = ?', [id_report]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Laporan tidak ditemukan' });
    }
    res.json({ success: true, message: 'Laporan berhasil dihapus' });
  } catch (error) {
    console.error("Error Admin Delete Report:", error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan' });
  }
});

// =========================================================
// ADMIN 10. UPDATE STATUS LAPORAN
// =========================================================
app.put('/api/admin/reports/:id_report/status', adminOnly, async (req, res) => {
  const { id_report } = req.params;
  const { status } = req.body;

  const validStatuses = ['pending', 'resolved', 'rejected'];
  if (!status || !validStatuses.includes(status)) {
    return res.status(400).json({ success: false, message: 'Status tidak valid. Gunakan: pending, resolved, atau rejected' });
  }

  try {
    const [result] = await pool.query('UPDATE reports SET status = ? WHERE id_report = ?', [status, id_report]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Laporan tidak ditemukan' });
    }
    res.json({ success: true, message: `Status laporan berhasil diubah ke ${status}` });
  } catch (error) {
    console.error("Error Admin Update Report Status:", error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan' });
  }
});

// =========================================================
// USER: KIRIM LAPORAN BARU
// =========================================================
app.post('/api/user/reports', async (req, res) => {
  const { id_user, judul, isi_laporan, kategori } = req.body;

  if (!id_user || !judul || !isi_laporan) {
    return res.status(400).json({ success: false, message: 'id_user, judul, dan isi_laporan wajib diisi!' });
  }

  try {
    // Ambil username dari profil user
    const [profiles] = await pool.query('SELECT nama FROM end_user_profiles WHERE id_user = ?', [id_user]);
    const username = profiles.length > 0 ? profiles[0].nama : 'Unknown';

    const id_report = uuidv4();
    await pool.query(
      'INSERT INTO reports (id_report, id_user, username, judul, isi_laporan, kategori) VALUES (?, ?, ?, ?, ?, ?)',
      [id_report, id_user, username, judul, isi_laporan, kategori || 'Umum']
    );

    res.status(201).json({ success: true, message: 'Laporan berhasil dikirim', id_report });
  } catch (error) {
    console.error("Error Create Report:", error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan pada server' });
  }
});

// =========================================================
// USER: SYNC RIWAYAT WORKOUT
// =========================================================
app.post('/api/user/workout', async (req, res) => {
  const { id_user, id_workout, tanggal, durasi_detik, kalori_terbakar } = req.body;

  if (!id_user || !tanggal) {
    return res.status(400).json({ success: false, message: 'id_user dan tanggal wajib diisi!' });
  }

  try {
    const id = id_workout || uuidv4();
    await pool.query(
      'INSERT IGNORE INTO workout_histories (id_workout, id_user, tanggal, durasi_detik, kalori_terbakar) VALUES (?, ?, ?, ?, ?)',
      [id, id_user, tanggal, durasi_detik || 0, kalori_terbakar || 0]
    );
    res.status(201).json({ success: true, message: 'Riwayat workout berhasil disimpan', id_workout: id });
  } catch (error) {
    console.error("Error Sync Workout:", error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan pada server' });
  }
});

// =========================================================
// 6. JALANKAN SERVER
// =========================================================

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 GoDiet API berjalan di port ${PORT}`);
});
