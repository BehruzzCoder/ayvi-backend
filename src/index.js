import "dotenv/config";
import express from "express";
import cors from "cors";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import pg from "pg";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT || 4000);
const JWT_SECRET = process.env.JWT_SECRET || "change-me-in-env";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "owner@klimathause.uz";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "KlimatOwner2026!";
const DATABASE_URL = process.env.DATABASE_URL;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsDir = path.join(__dirname, "..", "uploads");

if (!DATABASE_URL) {
  throw new Error("DATABASE_URL topilmadi. server/.env ga qo'shing.");
}

const { Pool } = pg;
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "") || ".jpg";
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
});
const uploadVideo = multer({
  storage,
  limits: { fileSize: 150 * 1024 * 1024 },
});

const PLACEHOLDER_PRODUCT_IMAGE = "/images/placeholder-product.jpg";
const hasRealImage = (images) =>
  Array.isArray(images) &&
  images.some((img) => typeof img === "string" && img.trim() && img.trim().toLowerCase() !== PLACEHOLDER_PRODUCT_IMAGE);

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      icon TEXT NOT NULL DEFAULT 'Package',
      description TEXT NOT NULL DEFAULT '',
      image TEXT NOT NULL DEFAULT '/images/categories/default.jpg',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    INSERT INTO categories (id, name, icon, description, image) VALUES
      ('air-fryers', 'Air Fryerlar', 'Wind', 'Sog''lom ovqat tayyorlash uchun zamonaviy havo fritozlari', '/images/categories/air-fryer.jpg'),
      ('air-conditioners', 'Konditsionerlar', 'Snowflake', 'Uy va ofis uchun samarali konditsioner tizimlari', '/images/categories/ac.jpg'),
      ('refrigerators', 'Muzlatgichlar', 'Thermometer', 'Yuqori sifatli energiya tejovchi muzlatgichlar', '/images/categories/fridge.jpg'),
      ('washing-machines', 'Kir yuvish mashinalari', 'Droplets', 'Aqlli va tejamkor kir yuvish mashinalari', '/images/categories/washing.jpg'),
      ('kitchen', 'Oshxona jihozlari', 'Utensils', 'Zamonaviy oshxona uchun barcha kerakli jihozlar', '/images/categories/kitchen.jpg'),
      ('home-care', 'Uy parvarishi', 'Home', 'Uy tozalash va parvarish uchun texnikalar', '/images/categories/homecare.jpg')
    ON CONFLICT (id) DO NOTHING;
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS settings (
      id SMALLINT PRIMARY KEY DEFAULT 1,
      company_name TEXT NOT NULL DEFAULT 'Klimat Hause',
      phone TEXT NOT NULL DEFAULT '+998712000000',
      email TEXT NOT NULL DEFAULT 'info@klimathause.uz',
      address TEXT NOT NULL DEFAULT 'Toshkent, O''zbekiston',
      telegram_url TEXT NOT NULL DEFAULT 'https://t.me/klimathause_test',
      whatsapp_url TEXT NOT NULL DEFAULT 'https://wa.me/998901234567?text=Salom%20Klimat%20Hause'
    );
  `);
  await pool.query(`
    INSERT INTO settings (id) VALUES (1)
    ON CONFLICT (id) DO NOTHING;
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY,
      full_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'customer',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS product_overrides (
      product_id TEXT PRIMARY KEY,
      price BIGINT,
      discount_price BIGINT,
      discount_percent INT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS custom_products (
      id UUID PRIMARY KEY,
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id UUID PRIMARY KEY,
      user_id UUID,
      status TEXT NOT NULL DEFAULT 'new',
      items JSONB NOT NULL,
      total BIGINT NOT NULL DEFAULT 0,
      customer JSONB NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ
    );
  `);
}

function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) {
    return res.status(401).json({ message: "Token topilmadi" });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    return next();
  } catch {
    return res.status(401).json({ message: "Yaroqsiz token" });
  }
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.user || req.user.role !== role) {
      return res.status(403).json({ message: "Ruxsat yo'q" });
    }
    return next();
  };
}

const app = express();
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.use(express.json({ limit: "1mb" }));
app.use("/uploads", express.static(uploadsDir));

app.get("/api/health", (_, res) => {
  res.json({ ok: true, service: "klimat-house-api" });
});

app.get("/api/settings", (_, res) => {
  pool
    .query("SELECT company_name, phone, email, address, telegram_url, whatsapp_url FROM settings WHERE id = 1")
    .then(({ rows }) => {
      const s = rows[0];
      res.json({
        companyName: s.company_name,
        phone: s.phone,
        email: s.email,
        address: s.address,
        telegramUrl: s.telegram_url,
        whatsappUrl: s.whatsapp_url,
      });
    })
    .catch(() => res.status(500).json({ message: "Settings o'qishda xatolik" }));
});

app.get("/api/products/overrides", (_, res) => {
  pool
    .query("SELECT product_id, price, discount_price, discount_percent, updated_at FROM product_overrides")
    .then(({ rows }) => {
      const map = {};
      rows.forEach((r) => {
        map[r.product_id] = {
          ...(r.price !== null ? { price: Number(r.price) } : {}),
          ...(r.discount_price !== null ? { discountPrice: Number(r.discount_price) } : {}),
          ...(r.discount_percent !== null ? { discountPercent: Number(r.discount_percent) } : {}),
          updatedAt: r.updated_at,
        };
      });
      res.json(map);
    })
    .catch(() => res.status(500).json({ message: "Overrides o'qishda xatolik" }));
});

app.get("/api/categories", (_, res) => {
  pool
    .query("SELECT id, name, icon, description, image FROM categories ORDER BY name ASC")
    .then(({ rows }) => res.json(rows))
    .catch(() => res.status(500).json({ message: "Kategoriyalarni o'qishda xatolik" }));
});

app.post("/api/admin/upload", authMiddleware, requireRole("admin"), upload.single("image"), (req, res) => {
  if (!req.file) return res.status(400).json({ message: "Fayl topilmadi" });
  const fileUrl = `${BASE_URL}/uploads/${req.file.filename}`;
  return res.status(201).json({ url: fileUrl, filename: req.file.filename });
});

app.post("/api/admin/upload-video", authMiddleware, requireRole("admin"), uploadVideo.single("video"), (req, res) => {
  if (!req.file) return res.status(400).json({ message: "Video topilmadi" });
  const fileUrl = `${BASE_URL}/uploads/${req.file.filename}`;
  return res.status(201).json({ url: fileUrl, filename: req.file.filename });
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ message: "Email va parol majburiy" });
  }

  if (email !== ADMIN_EMAIL) {
    return res.status(401).json({ message: "Login xato" });
  }

  const passwordOk = await bcrypt.compare(password, await bcrypt.hash(ADMIN_PASSWORD, 10));
  if (!passwordOk) {
    return res.status(401).json({ message: "Login xato" });
  }

  const token = jwt.sign({ role: "admin", email }, JWT_SECRET, { expiresIn: "12h" });
  return res.json({ token, user: { email, role: "admin" } });
});

app.post("/api/auth/register", async (req, res) => {
  const { fullName, phone, email, password } = req.body || {};
  if (!fullName || !phone || !email || !password) {
    return res.status(400).json({ message: "Barcha maydonlar majburiy" });
  }

  const normalizedEmail = String(email).toLowerCase();
  const exists = await pool.query("SELECT id FROM users WHERE email = $1", [normalizedEmail]);
  if (exists.rowCount) return res.status(409).json({ message: "Bu email allaqachon ro'yxatdan o'tgan" });

  const passwordHash = await bcrypt.hash(password, 10);
  const user = {
    id: randomUUID(),
    fullName,
    phone,
    email: normalizedEmail,
    role: "customer",
  };
  await pool.query(
    "INSERT INTO users (id, full_name, phone, email, password_hash, role) VALUES ($1,$2,$3,$4,$5,$6)",
    [user.id, user.fullName, user.phone, user.email, passwordHash, user.role]
  );

  const token = jwt.sign({ role: user.role, email: user.email, userId: user.id }, JWT_SECRET, { expiresIn: "12h" });
  return res.status(201).json({
    token,
    user: { id: user.id, fullName: user.fullName, phone: user.phone, email: user.email, role: user.role },
  });
});

app.post("/api/auth/customer-login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ message: "Email va parol majburiy" });
  }

  const normalizedEmail = String(email).toLowerCase();
  const result = await pool.query(
    "SELECT id, full_name, phone, email, password_hash, role FROM users WHERE email = $1",
    [normalizedEmail]
  );
  const row = result.rows[0];
  if (!row) return res.status(401).json({ message: "Login xato" });

  const passwordOk = await bcrypt.compare(password, row.password_hash);
  if (!passwordOk) {
    return res.status(401).json({ message: "Login xato" });
  }

  const token = jwt.sign({ role: row.role, email: row.email, userId: row.id }, JWT_SECRET, { expiresIn: "12h" });
  return res.json({
    token,
    user: { id: row.id, fullName: row.full_name, phone: row.phone, email: row.email, role: row.role },
  });
});

app.get("/api/auth/me", authMiddleware, async (req, res) => {
  if (req.user.role === "admin") {
    return res.json({ email: req.user.email, role: "admin" });
  }
  const result = await pool.query("SELECT id, full_name, phone, email, role FROM users WHERE id = $1", [req.user.userId]);
  const user = result.rows[0];
  if (!user) return res.status(404).json({ message: "Foydalanuvchi topilmadi" });
  return res.json({
    id: user.id,
    fullName: user.full_name,
    phone: user.phone,
    email: user.email,
    role: user.role,
  });
});

app.get("/api/products", (_, res) => {
  pool
    .query("SELECT payload FROM custom_products ORDER BY created_at DESC")
    .then(({ rows }) => res.json(rows.map((r) => r.payload)))
    .catch(() => res.status(500).json({ message: "Mahsulotlarni o'qishda xatolik" }));
});

app.get("/api/admin/orders", authMiddleware, requireRole("admin"), (_, res) => {
  pool
    .query("SELECT id, user_id, status, items, total, customer, note, created_at, updated_at FROM orders ORDER BY created_at DESC")
    .then(({ rows }) =>
      res.json(
        rows.map((r) => ({
          id: r.id,
          userId: r.user_id,
          status: r.status,
          items: r.items,
          total: Number(r.total),
          customer: r.customer,
          note: r.note,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        }))
      )
    )
    .catch(() => res.status(500).json({ message: "Orders o'qishda xatolik" }));
});

app.get("/api/admin/users", authMiddleware, requireRole("admin"), (_, res) => {
  pool
    .query("SELECT id, full_name, phone, email, role, created_at FROM users ORDER BY created_at DESC")
    .then(({ rows }) =>
      res.json(
        rows.map((u) => ({
          id: u.id,
          fullName: u.full_name,
          phone: u.phone,
          email: u.email,
          role: u.role,
          createdAt: u.created_at,
        }))
      )
    )
    .catch(() => res.status(500).json({ message: "Users o'qishda xatolik" }));
});

app.post("/api/admin/categories", authMiddleware, requireRole("admin"), (req, res) => {
  const payload = req.body || {};
  if (!payload.id || !payload.name) {
    return res.status(400).json({ message: "id va name majburiy" });
  }
  pool
    .query(
      "INSERT INTO categories (id, name, icon, description, image, updated_at) VALUES ($1,$2,$3,$4,$5,NOW()) RETURNING id, name, icon, description, image",
      [payload.id, payload.name, payload.icon || "Package", payload.description || "", payload.image || "/images/categories/default.jpg"]
    )
    .then(({ rows }) => res.status(201).json(rows[0]))
    .catch(() => res.status(500).json({ message: "Kategoriya qo'shishda xatolik" }));
});

app.put("/api/admin/categories/:id", authMiddleware, requireRole("admin"), (req, res) => {
  const { id } = req.params;
  const payload = req.body || {};
  pool
    .query(
      `
      UPDATE categories
      SET name = COALESCE($1, name),
          icon = COALESCE($2, icon),
          description = COALESCE($3, description),
          image = COALESCE($4, image),
          updated_at = NOW()
      WHERE id = $5
      RETURNING id, name, icon, description, image
      `,
      [payload.name ?? null, payload.icon ?? null, payload.description ?? null, payload.image ?? null, id]
    )
    .then(({ rows }) => {
      if (!rows[0]) return res.status(404).json({ message: "Kategoriya topilmadi" });
      return res.json(rows[0]);
    })
    .catch(() => res.status(500).json({ message: "Kategoriya tahrirlashda xatolik" }));
});

app.delete("/api/admin/categories/:id", authMiddleware, requireRole("admin"), (req, res) => {
  const { id } = req.params;
  pool
    .query("DELETE FROM categories WHERE id = $1", [id])
    .then(() => res.json({ success: true }))
    .catch(() => res.status(500).json({ message: "Kategoriya o'chirishda xatolik" }));
});

app.put("/api/admin/products/:id/override", authMiddleware, requireRole("admin"), (req, res) => {
  const { id } = req.params;
  const { price, discountPrice, discountPercent } = req.body || {};

  if (!id) {
    return res.status(400).json({ message: "Mahsulot ID kerak" });
  }

  pool
    .query(
      `
      INSERT INTO product_overrides (product_id, price, discount_price, discount_percent, updated_at)
      VALUES ($1,$2,$3,$4,NOW())
      ON CONFLICT (product_id)
      DO UPDATE SET price = EXCLUDED.price, discount_price = EXCLUDED.discount_price, discount_percent = EXCLUDED.discount_percent, updated_at = NOW()
      RETURNING product_id, price, discount_price, discount_percent, updated_at
      `,
      [id, typeof price === "number" ? price : null, typeof discountPrice === "number" ? discountPrice : null, typeof discountPercent === "number" ? discountPercent : null]
    )
    .then(({ rows }) => {
      const r = rows[0];
      res.json({
        success: true,
        override: {
          ...(r.price !== null ? { price: Number(r.price) } : {}),
          ...(r.discount_price !== null ? { discountPrice: Number(r.discount_price) } : {}),
          ...(r.discount_percent !== null ? { discountPercent: Number(r.discount_percent) } : {}),
          updatedAt: r.updated_at,
        },
      });
    })
    .catch(() => res.status(500).json({ message: "Override saqlashda xatolik" }));
});

app.put("/api/admin/settings", authMiddleware, requireRole("admin"), (req, res) => {
  const payload = req.body || {};
  pool
    .query(
      `
      UPDATE settings
      SET company_name = COALESCE($1, company_name),
          phone = COALESCE($2, phone),
          email = COALESCE($3, email),
          address = COALESCE($4, address),
          telegram_url = COALESCE($5, telegram_url),
          whatsapp_url = COALESCE($6, whatsapp_url)
      WHERE id = 1
      RETURNING company_name, phone, email, address, telegram_url, whatsapp_url
      `,
      [
        payload.companyName ?? null,
        payload.phone ?? null,
        payload.email ?? null,
        payload.address ?? null,
        payload.telegramUrl ?? null,
        payload.whatsappUrl ?? null,
      ]
    )
    .then(({ rows }) => {
      const s = rows[0];
      res.json({
        companyName: s.company_name,
        phone: s.phone,
        email: s.email,
        address: s.address,
        telegramUrl: s.telegram_url,
        whatsappUrl: s.whatsapp_url,
      });
    })
    .catch(() => res.status(500).json({ message: "Settings saqlashda xatolik" }));
});

app.post("/api/admin/products", authMiddleware, requireRole("admin"), (req, res) => {
  const payload = req.body || {};
  if (!payload.name || !payload.model || !payload.category || typeof payload.price !== "number") {
    return res.status(400).json({ message: "name, model, category, price majburiy" });
  }
  if (!hasRealImage(payload.images)) {
    return res.status(400).json({ message: "Kamida bitta haqiqiy rasm majburiy" });
  }
  const product = {
    id: randomUUID(),
    name: payload.name,
    model: payload.model,
    category: payload.category,
    subcategory: payload.subcategory || payload.category,
    description: payload.description || "",
    fullDescription: payload.fullDescription || payload.description || "",
    price: payload.price,
    discountPrice: payload.discountPrice,
    discountPercent: payload.discountPercent,
    images: payload.images,
    videoUrl: payload.videoUrl || "",
    specs: Array.isArray(payload.specs) ? payload.specs : [],
    parts: Array.isArray(payload.parts) ? payload.parts : [],
    features: Array.isArray(payload.features) ? payload.features : [],
    inStock: payload.inStock !== false,
    warranty: payload.warranty || "1 yil",
  };
  pool
    .query("INSERT INTO custom_products (id, payload) VALUES ($1, $2::jsonb)", [product.id, JSON.stringify(product)])
    .then(() => res.status(201).json(product))
    .catch(() => res.status(500).json({ message: "Mahsulot qo'shishda xatolik" }));
});

app.put("/api/admin/products/:id", authMiddleware, requireRole("admin"), (req, res) => {
  const { id } = req.params;
  const payload = { ...(req.body || {}), id };
  if (!hasRealImage(payload.images)) {
    return res.status(400).json({ message: "Kamida bitta haqiqiy rasm majburiy" });
  }
  pool
    .query(
      `
      INSERT INTO custom_products (id, payload, updated_at)
      VALUES ($1, $2::jsonb, NOW())
      ON CONFLICT (id)
      DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()
      RETURNING payload
      `,
      [id, JSON.stringify(payload)]
    )
    .then(({ rows }) => res.json(rows[0].payload))
    .catch(() => res.status(500).json({ message: "Mahsulot update xato" }));
});

app.delete("/api/admin/products/:id", authMiddleware, requireRole("admin"), (req, res) => {
  const { id } = req.params;
  pool
    .query("DELETE FROM custom_products WHERE id = $1", [id])
    .then(() => res.json({ success: true }))
    .catch(() => res.status(500).json({ message: "Mahsulot o'chirish xato" }));
});

app.put("/api/admin/orders/:id/status", authMiddleware, requireRole("admin"), (req, res) => {
  const { id } = req.params;
  const { status } = req.body || {};
  const allowed = ["new", "confirmed", "shipping", "delivered", "cancelled"];
  if (!allowed.includes(status)) return res.status(400).json({ message: "status noto'g'ri" });
  pool
    .query(
      "UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING id, user_id, status, items, total, customer, note, created_at, updated_at",
      [status, id]
    )
    .then(({ rows }) => {
      if (!rows[0]) return res.status(404).json({ message: "Order topilmadi" });
      const r = rows[0];
      return res.json({
        id: r.id,
        userId: r.user_id,
        status: r.status,
        items: r.items,
        total: Number(r.total),
        customer: r.customer,
        note: r.note,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      });
    })
    .catch(() => res.status(500).json({ message: "Order status update xato" }));
});

app.post("/api/orders", authMiddleware, requireRole("customer"), async (req, res) => {
  const { items = [], total = 0, note = "" } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ message: "Buyurtma bo'sh" });
  }

  const userResult = await pool.query("SELECT id, full_name, phone, email FROM users WHERE id = $1", [req.user.userId]);
  const user = userResult.rows[0];
  const order = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    status: "new",
    userId: req.user.userId,
    items,
    total,
    customer: user ? { id: user.id, fullName: user.full_name, phone: user.phone, email: user.email } : {},
    note,
  };
  await pool.query(
    "INSERT INTO orders (id, user_id, status, items, total, customer, note, created_at) VALUES ($1,$2,$3,$4::jsonb,$5,$6::jsonb,$7,$8)",
    [order.id, order.userId, order.status, JSON.stringify(order.items), order.total, JSON.stringify(order.customer), order.note, order.createdAt]
  );
  return res.status(201).json(order);
});

initDb()
  .then(() => {
    const server = app.listen(PORT, () => {
      console.log(`API running on http://localhost:${PORT}`);
    });
    server.on("error", (error) => {
      if (error?.code === "EADDRINUSE") {
        console.error(`Port ${PORT} allaqachon band. Bitta server nusxasi qoldiring.`);
        process.exit(1);
      }
      console.error("Server ishga tushishda xatolik:", error?.message || error);
      process.exit(1);
    });
  })
  .catch((error) => {
    console.error("Database init xatosi:", error.message);
    process.exit(1);
  });
