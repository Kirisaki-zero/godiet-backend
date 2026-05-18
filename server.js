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
};

let pool;

async function initDB() {
  try {
    pool = mysql.createPool(dbConfig);
    // Jalankan migrasi: buat tabel jika belum ada
    await runMigrations();
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
      foto_profil TEXT DEFAULT '',
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
  ];

  for (const query of queries) {
    await pool.query(query);
  }
  console.log("✅ Migrasi tabel selesai.");
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
    jenis_kelamin, tingkat_aktivitas, target_kalori_harian
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
      'INSERT INTO end_user_profiles (id_user, nama, berat_badan, tinggi_badan, usia, jenis_kelamin, tingkat_aktivitas, target_kalori_harian) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [id_user, nama || '', berat_badan || 0, tinggi_badan || 0, usia || 0, jenis_kelamin || '', tingkat_aktivitas || '', target_kalori_harian || 0]
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
  const { nama, berat_badan, tinggi_badan, usia, jenis_kelamin, tingkat_aktivitas, target_kalori_harian, foto_profil } = req.body;

  try {
    await pool.query(
      'UPDATE end_user_profiles SET nama=?, berat_badan=?, tinggi_badan=?, usia=?, jenis_kelamin=?, tingkat_aktivitas=?, target_kalori_harian=?, foto_profil=? WHERE id_user=?',
      [nama, berat_badan, tinggi_badan, usia, jenis_kelamin, tingkat_aktivitas, target_kalori_harian, foto_profil || '', id_user]
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
// 6. JALANKAN SERVER
// =========================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 GoDiet API berjalan di port ${PORT}`);
});
