const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { exec } = require('child_process');
const crypto = require('crypto');

const app = express();
const port = process.env.PORT || 3000;
const SECRET_SALT = 'vms-license-salt-2025';

// Determine if running in packaged environment or via VMS_Engine
const isPkg = typeof process.pkg !== 'undefined';
const isVmsEngine = process.execPath.toLowerCase().includes('vms_engine.exe');

// Database Path: external if packaged/engine, local if developing, or env-defined
const baseDir = (isPkg || isVmsEngine)
    ? path.dirname(process.execPath)
    : __dirname;
const dbPath = process.env.DATABASE_URL || path.join(baseDir, 'database.sqlite');

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(session({
    secret: 'antigravity-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24 hours
}));

// Database Setup
let db;
const useTurso = process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN;

if (useTurso) {
    const { createClient } = require('@libsql/client');
    const client = createClient({
        url: process.env.TURSO_DATABASE_URL,
        authToken: process.env.TURSO_AUTH_TOKEN,
    });

    // Wrapper to make Turso client look like sqlite3 for basic queries
    db = {
        run: (sql, params, callback) => {
            if (typeof params === 'function') { callback = params; params = []; }
            client.execute({ sql, args: params || [] })
                .then(res => callback && callback(null, { lastID: res.lastInsertRowid, changes: Number(res.rowsAffected) }))
                .catch(err => callback && callback(err));
        },
        get: (sql, params, callback) => {
            if (typeof params === 'function') { callback = params; params = []; }
            client.execute({ sql, args: params || [] })
                .then(res => callback && callback(null, res.rows[0]))
                .catch(err => callback && callback(err));
        },
        all: (sql, params, callback) => {
            if (typeof params === 'function') { callback = params; params = []; }
            client.execute({ sql, args: params || [] })
                .then(res => callback && callback(null, res.rows))
                .catch(err => callback && callback(err));
        },
        serialize: (fn) => fn(),
        prepare: (sql) => {
            return {
                run: (params, callback) => {
                    client.execute({ sql, args: params || [] })
                        .then(() => callback && callback(null))
                        .catch(err => callback && callback(err));
                },
                finalize: (callback) => callback && callback(null)
            };
        }
    };
    console.log('Using Turso Cloud Database');
} else {
    const sqlite3 = require('sqlite3').verbose();
    db = new sqlite3.Database(dbPath, (err) => {
        if (err) console.error('Error opening database:', err.message);
        else console.log('Connected to local SQLite database.');
    });
}

// Initial Schema Setup
db.serialize(() => {
    // Vehicles table
    db.run(`CREATE TABLE IF NOT EXISTS vehicles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ownerName TEXT,
                idNumber TEXT,
                plateNumber TEXT,
                permitExpiryDate TEXT,
                modelYear TEXT,
                vehicleName TEXT,
                category TEXT,
                status TEXT,
                isOnHold INTEGER DEFAULT 0,
                owner_id INTEGER DEFAULT 0
            )`);

    // Migration: Add owner_id if missing
    db.run("ALTER TABLE vehicles ADD COLUMN owner_id INTEGER DEFAULT 0", (err) => {
        if (err && !err.message.includes('duplicate column name')) {
            console.error('Migration Error (owner_id):', err.message);
        }
    });

    // Shares table
    db.run(`CREATE TABLE IF NOT EXISTS vehicle_shares (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                vehicle_id INTEGER,
                shared_by_user_id INTEGER,
                shared_to_user_id INTEGER,
                FOREIGN KEY(vehicle_id) REFERENCES vehicles(id),
                FOREIGN KEY(shared_by_user_id) REFERENCES users(id),
                FOREIGN KEY(shared_to_user_id) REFERENCES users(id)
            )`);

    // Users table for security
    db.run(`CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE,
                password TEXT
            )`, () => {
        // Ensure role column exists
        db.run("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user'", (err) => { });

        // Create default admin user if not exists
        const salt = bcrypt.genSaltSync(10);
        const hashedPassword = bcrypt.hashSync('admin789', salt);
        db.run('INSERT OR IGNORE INTO users (username, password, role) VALUES (?, ?, ?)', ['admin', hashedPassword, 'admin']);
    });

    // License/System table
    db.run(`CREATE TABLE IF NOT EXISTS system_config (
                key TEXT PRIMARY KEY,
                value TEXT
            )`, () => {
        db.get("SELECT value FROM system_config WHERE key = 'install_date'", (err, row) => {
            if (!row) {
                db.run("INSERT INTO system_config (key, value) VALUES ('install_date', ?)", [new Date().toISOString()]);
            }
        });
        db.get("SELECT value FROM system_config WHERE key = 'is_activated'", (err, row) => {
            if (!row) {
                db.run("INSERT INTO system_config (key, value) VALUES ('is_activated', ?)", ['false']);
            }
        });
    });
});

// License Helpers
function generateLicenseKey(seed) {
    return 'VMS-' + crypto.createHash('md5').update(seed + SECRET_SALT).digest('hex').toUpperCase().substring(0, 16);
}

function checkLicenseStatus(callback) {
    db.all("SELECT * FROM system_config", (err, rows) => {
        if (err) return callback(err);
        const config = {};
        rows.forEach(r => config[r.key] = r.value);

        const isActivated = config.is_activated === 'true';
        const installDate = new Date(config.install_date);
        const now = new Date();
        const diffDays = Math.ceil((now - installDate) / (1000 * 60 * 60 * 24));
        const trialRemaining = Math.max(0, 15 - diffDays);
        const isExpired = !isActivated && trialRemaining <= 0;

        callback(null, { isActivated, trialRemaining, isExpired, installId: config.install_date });
    });
}

// License Middleware
function requireValidLicense(req, res, next) {
    // Skip license check for activation endpoint
    if (req.path === '/api/activate' || req.path === '/api/license-status') return next();

    checkLicenseStatus((err, status) => {
        if (err) return res.status(500).json({ error: 'License check error' });
        if (status.isExpired) {
            return res.status(402).json({
                error: 'Trial Expired',
                message: 'Your 15-day trial has expired. Please activate the full version.'
            });
        }
        next();
    });
}

// Auth Middleware
function isAuthenticated(req, res, next) {
    if (req.session.userId) {
        return next();
    }
    if (req.path.startsWith('/api/')) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    res.redirect('/login.html');
}

// Public Routes
// Middleware to check if user is admin
function requireAdmin(req, res, next) {
    if (req.session.role !== 'admin') {
        return res.status(403).json({ error: 'Access denied' });
    }
    next();
}

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    db.get('SELECT * FROM users WHERE username = ?', [username], (err, user) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!user || !bcrypt.compareSync(password, user.password)) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        req.session.userId = user.id;
        req.session.role = user.role; // Store role in session
        res.json({ success: true, role: user.role });
    });
});

app.get('/login.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

// Public License Status
app.get('/api/license-status', (req, res) => {
    checkLicenseStatus((err, status) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(status);
    });
});

app.post('/api/activate', (req, res) => {
    const { key } = req.body;
    if (!key) return res.status(400).json({ error: 'Key required' });

    // For simplicity, we use the install_date as seed for valid key
    // In a real app, you might use hardware ID or similar
    db.get("SELECT value FROM system_config WHERE key = 'install_date'", (err, row) => {
        const validKey = generateLicenseKey(row.value);
        if (key === validKey) {
            db.run("UPDATE system_config SET value = 'true' WHERE key = 'is_activated'", (err) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ success: true, message: 'Activation successful!' });
            });
        } else {
            res.status(400).json({ error: 'Invalid Serial Key' });
        }
    });
});

// Protected Section
app.use(requireValidLicense);
app.use(isAuthenticated);

// User Management Endpoints
app.get('/api/users/me', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
    db.get('SELECT id, username, role FROM users WHERE id = ?', [req.session.userId], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(row);
    });
});

// Admin: Get all users
app.get('/api/users', requireAdmin, (req, res) => {
    db.all('SELECT id, username, role FROM users', [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Admin: Create user
app.post('/api/users', requireAdmin, (req, res) => {
    const { username, password, role } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Missing fields' });

    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync(password, salt);
    const userRole = role || 'user';

    db.run('INSERT INTO users (username, password, role) VALUES (?, ?, ?)', [username, hash, userRole], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, id: this.lastID });
    });
});

// Admin: Delete user
app.delete('/api/users/:id', requireAdmin, (req, res) => {
    const id = req.params.id;
    if (id == req.session.userId) { // Soft check (ids are numbers/strings)
        return res.status(400).json({ error: 'Cannot delete yourself' });
    }
    db.run('DELETE FROM users WHERE id = ?', [id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// Admin: Update user
app.put('/api/users/:id', requireAdmin, (req, res) => {
    const { password, role } = req.body;
    const id = req.params.id;

    let query = 'UPDATE users SET role = ? WHERE id = ?';
    let params = [role, id];

    if (password) {
        const salt = bcrypt.genSaltSync(10);
        const hash = bcrypt.hashSync(password, salt);
        query = 'UPDATE users SET role = ?, password = ? WHERE id = ?';
        params = [role, hash, id];
    }

    db.run(query, params, (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

app.post('/api/users/create', (req, res) => {
    const { username, password } = req.body;
    const salt = bcrypt.genSaltSync(10);
    const hashedPassword = bcrypt.hashSync(password, salt);

    db.run('INSERT INTO users (username, password) VALUES (?, ?)', [username, hashedPassword], (err) => {
        if (err) {
            if (err.message.includes('UNIQUE constraint failed')) {
                return res.status(400).json({ error: 'Username already exists' });
            }
            return res.status(500).json({ error: err.message });
        }
        res.json({ success: true });
    });
});

// Protected Static Files
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/index.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/report.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'report.html'));
});

// Helper: Calculate Status
function calculateStatus(expiryDate, onHold) {
    if (onHold) return 'On Hold';
    const today = new Date();
    const expiry = new Date(expiryDate);
    const diffTime = expiry - today;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays < 0) return 'Invalid';
    if (diffDays <= 10) return 'Expiring Soon';
    return 'Valid';
}

// API Routes
app.get('/api/users/search', (req, res) => {
    const query = req.query.q;
    if (!query) return res.json([]);
    // Don't show self or admins in search
    db.all("SELECT id, username FROM users WHERE username LIKE ? AND role != 'admin' AND id != ? LIMIT 5", [`%${query}%`, req.session.userId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Get list of users to share with
app.get('/api/users/shareable', (req, res) => {
    const userId = req.session.userId;
    const role = req.session.role;

    // Return all users except self (and exclude admins for non-admins)
    const sql = role === 'admin'
        ? "SELECT id, username FROM users WHERE id != ?"
        : "SELECT id, username FROM users WHERE id != ? AND role != 'admin'";

    db.all(sql, [userId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Create bulk share requests
app.post('/api/share-requests', (req, res) => {
    const { vehicleIds, targetUserIds } = req.body;

    if (!Array.isArray(vehicleIds) || !Array.isArray(targetUserIds)) {
        return res.status(400).json({ error: 'Invalid request format' });
    }

    if (vehicleIds.length === 0 || targetUserIds.length === 0) {
        return res.status(400).json({ error: 'No vehicles or users selected' });
    }

    const userId = req.session.userId;
    const stmt = db.prepare(`INSERT INTO share_requests (vehicle_id, shared_by_user_id, shared_to_user_id, status, created_at, updated_at) 
                             VALUES (?, ?, ?, 'pending', datetime('now'), datetime('now'))`);

    let insertCount = 0;
    let errors = [];

    vehicleIds.forEach(vehicleId => {
        targetUserIds.forEach(targetUserId => {
            stmt.run([vehicleId, userId, targetUserId], (err) => {
                if (err) {
                    errors.push(`Vehicle ${vehicleId} to User ${targetUserId}: ${err.message}`);
                } else {
                    insertCount++;
                }
            });
        });
    });

    stmt.finalize((err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({
            success: true,
            requestsCreated: insertCount,
            errors: errors.length > 0 ? errors : undefined
        });
    });
});

// Get pending share requests for current user
app.get('/api/share-requests/pending', (req, res) => {
    const userId = req.session.userId;

    const sql = `
        SELECT sr.id, sr.vehicle_id, sr.shared_by_user_id, sr.created_at,
               v.vehicleName, v.plateNumber, v.ownerName,
               u.username as shared_by_username
        FROM share_requests sr
        JOIN vehicles v ON sr.vehicle_id = v.id
        JOIN users u ON sr.shared_by_user_id = u.id
        WHERE sr.shared_to_user_id = ? AND sr.status = 'pending'
        ORDER BY sr.created_at DESC
    `;

    db.all(sql, [userId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Get sent share requests by current user
app.get('/api/share-requests/sent', (req, res) => {
    const userId = req.session.userId;

    const sql = `
        SELECT sr.id, sr.vehicle_id, sr.shared_to_user_id, sr.status, sr.created_at, sr.updated_at,
               v.vehicleName, v.plateNumber,
               u.username as shared_to_username
        FROM share_requests sr
        JOIN vehicles v ON sr.vehicle_id = v.id
        JOIN users u ON sr.shared_to_user_id = u.id
        WHERE sr.shared_by_user_id = ?
        ORDER BY sr.created_at DESC
    `;

    db.all(sql, [userId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Accept share request
app.post('/api/share-requests/:id/accept', (req, res) => {
    const requestId = req.params.id;
    const userId = req.session.userId;

    // Verify this request is for the current user
    db.get("SELECT * FROM share_requests WHERE id = ? AND shared_to_user_id = ?", [requestId, userId], (err, request) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!request) return res.status(404).json({ error: 'Request not found' });
        if (request.status !== 'pending') return res.status(400).json({ error: 'Request already processed' });

        db.serialize(() => {
            // Update request status
            db.run("UPDATE share_requests SET status = 'accepted', updated_at = datetime('now') WHERE id = ?", [requestId]);

            // Add to vehicle_shares table
            db.run("INSERT OR IGNORE INTO vehicle_shares (vehicle_id, shared_by_user_id, shared_to_user_id) VALUES (?, ?, ?)",
                [request.vehicle_id, request.shared_by_user_id, request.shared_to_user_id], (err) => {
                    if (err) return res.status(500).json({ error: err.message });
                    res.json({ success: true });
                });
        });
    });
});

// Reject share request
app.post('/api/share-requests/:id/reject', (req, res) => {
    const requestId = req.params.id;
    const userId = req.session.userId;

    // Verify this request is for the current user
    db.get("SELECT * FROM share_requests WHERE id = ? AND shared_to_user_id = ?", [requestId, userId], (err, request) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!request) return res.status(404).json({ error: 'Request not found' });
        if (request.status !== 'pending') return res.status(400).json({ error: 'Request already processed' });

        // Update request status
        db.run("UPDATE share_requests SET status = 'rejected', updated_at = datetime('now') WHERE id = ?", [requestId], (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        });
    });
});

app.get('/api/vehicles', (req, res) => {
    const userId = req.session.userId;
    const role = req.session.role;

    if (role === 'admin') {
        // Admin sees ALL, plus owner info
        const sql = `
            SELECT v.*, u.username as owner_username 
            FROM vehicles v 
            LEFT JOIN users u ON v.owner_id = u.id
        `;
        db.all(sql, [], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            const updatedRows = rows.map(v => ({
                ...v,
                status: calculateStatus(v.permitExpiryDate, v.isOnHold),
                access_level: 'admin'
            }));
            res.json(updatedRows);
        });
    } else {
        // Regular User sees OWN + SHARED
        const sql = `
            SELECT v.*, 'owner' as access_level 
            FROM vehicles v 
            WHERE v.owner_id = ?
            
            UNION
            
            SELECT v.*, 'shared' as access_level
            FROM vehicles v
            JOIN vehicle_shares vs ON v.id = vs.vehicle_id
            WHERE vs.shared_to_user_id = ?
        `;
        db.all(sql, [userId, userId], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            const updatedRows = rows.map(v => ({
                ...v,
                status: calculateStatus(v.permitExpiryDate, v.isOnHold)
            }));
            res.json(updatedRows);
        });
    }
});

app.post('/api/vehicles', (req, res) => {
    const { ownerName, idNumber, plateNumber, permitExpiryDate, modelYear, vehicleName, category, isOnHold } = req.body;
    const ownerId = req.session.userId;

    const sql = `INSERT INTO vehicles (ownerName, idNumber, plateNumber, permitExpiryDate, modelYear, vehicleName, category, isOnHold, owner_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    const params = [ownerName, idNumber, plateNumber, permitExpiryDate, modelYear, vehicleName, category, isOnHold ? 1 : 0, ownerId];
    db.run(sql, params, function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id: this.lastID, status: calculateStatus(permitExpiryDate, isOnHold) });
    });
});

app.put('/api/vehicles/:id', (req, res) => {
    const { ownerName, idNumber, plateNumber, permitExpiryDate, modelYear, vehicleName, category, isOnHold } = req.body;

    // Check ownership
    const checkSql = "SELECT owner_id FROM vehicles WHERE id = ?";
    db.get(checkSql, [req.params.id], (err, row) => {
        if (!row) return res.status(404).json({ error: 'Vehicle not found' });

        if (req.session.role !== 'admin' && row.owner_id !== req.session.userId) {
            return res.status(403).json({ error: 'You can only edit your own vehicles' });
        }

        const sql = `UPDATE vehicles SET ownerName=?, idNumber=?, plateNumber=?, permitExpiryDate=?, modelYear=?, vehicleName=?, category=?, isOnHold=? 
                     WHERE id=?`;
        const params = [ownerName, idNumber, plateNumber, permitExpiryDate, modelYear, vehicleName, category, isOnHold ? 1 : 0, req.params.id];
        db.run(sql, params, function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ updated: this.changes, status: calculateStatus(permitExpiryDate, isOnHold) });
        });
    });
});

app.delete('/api/vehicles/:id', (req, res) => {
    // Check ownership
    const checkSql = "SELECT owner_id FROM vehicles WHERE id = ?";
    db.get(checkSql, [req.params.id], (err, row) => {
        if (!row) return res.status(404).json({ error: 'Vehicle not found' });

        if (req.session.role !== 'admin' && row.owner_id !== req.session.userId) {
            return res.status(403).json({ error: 'You can only delete your own vehicles' });
        }

        db.run('DELETE FROM vehicles WHERE id = ?', req.params.id, function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ deleted: this.changes });
        });
    });
});

// Backup/Restore
app.get('/api/backup', (req, res) => {
    res.download(dbPath, 'vehicle_backup.sqlite');
});

// JSON Backup for easier Restore
app.get('/api/backup-json', (req, res) => {
    db.all('SELECT * FROM vehicles', [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/restore', (req, res) => {
    const vehicles = req.body;
    if (!Array.isArray(vehicles)) return res.status(400).json({ error: 'Invalid data format' });

    db.serialize(() => {
        db.run('DELETE FROM vehicles', (err) => {
            if (err) return res.status(500).json({ error: err.message });

            const stmt = db.prepare(`INSERT INTO vehicles (ownerName, idNumber, plateNumber, permitExpiryDate, modelYear, vehicleName, category, isOnHold)
                                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);

            vehicles.forEach(v => {
                stmt.run([v.ownerName, v.idNumber, v.plateNumber, v.permitExpiryDate, v.modelYear, v.vehicleName, v.category, v.isOnHold]);
            });

            stmt.finalize((err) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ success: true, count: vehicles.length });
            });
        });
    });
});

// Start Server
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);

    // Auto-open browser in standalone mode
    if (isPkg) {
        const url = `http://localhost:${port}`;
        const startCommand = process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open';
        exec(`${startCommand} ${url}`);
    }
});
