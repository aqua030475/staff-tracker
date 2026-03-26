const express = require('express');
const nodemailer = require('nodemailer');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = process.env.PORT || 3000;

// SQLite データベースの設定
const db = new sqlite3.Database('./database.sqlite', (err) => {
    if (err) {
        console.error('データベースの接続に失敗しました:', err.message);
    } else {
        console.log('✅ SQLiteデータベースに接続しました。');
        // visits テーブルの作成
        db.run(`CREATE TABLE IF NOT EXISTS visits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            staff_name TEXT,
            visit_date TEXT,
            time_range TEXT,
            location TEXT,
            duration TEXT,
            category TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`, (err) => {
            if (err) {
                console.error('テーブルの作成に失敗しました:', err.message);
            } else {
                console.log('✅ visitsテーブルの準備が完了しました。');
                // 既存のテーブルにcategoryカラムがない場合の追加処理（エラーは無視）
                db.run(`ALTER TABLE visits ADD COLUMN category TEXT`, () => {});
            }
        });

        // 施設(facilities)と患者(patients)テーブルの作成
        db.serialize(() => {
            db.run(`CREATE TABLE IF NOT EXISTS facilities (
                id TEXT PRIMARY KEY,
                name TEXT,
                lat REAL,
                lng REAL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);
            
            db.run(`CREATE TABLE IF NOT EXISTS patients (
                id TEXT PRIMARY KEY,
                facility_id TEXT,
                name TEXT,
                room TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`, () => {
                // 初期データ挿入（データがない場合のみ）
                db.get("SELECT COUNT(*) as count FROM facilities", [], (err, row) => {
                    if (row && row.count === 0) {
                        console.log('🌱 初期施設データを挿入します...');
                        const stmtFac = db.prepare(`INSERT INTO facilities (id, name, lat, lng) VALUES (?, ?, ?, ?)`);
                        const stmtPat = db.prepare(`INSERT INTO patients (id, facility_id, name, room) VALUES (?, ?, ?, ?)`);
                        
                        stmtFac.run('f1', 'さくら老人ホーム', 35.689500, 139.691700);
                        stmtFac.run('f2', 'ひまわりケアセンター', 35.681236, 139.767125);
                        
                        stmtPat.run('1', 'f1', '山田 太郎 様', '101号室 / 定期往診・リハビリ');
                        stmtPat.run('2', 'f1', '佐藤 花子 様', '202号室 / 採血・点滴設定なし');
                        stmtPat.run('3', 'f2', '鈴木 一郎 様', '3F / 鍼灸・マッサージ');
                        
                        stmtFac.finalize();
                        stmtPat.finalize();
                    }
                });
            });
        });
    }
});
// ミドルウェアの設定（別ドメインからのアクセス許可とJSONパース）
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname)); // ローカルHTMLファイルの配信用

// ==========================================
// ⚠️ 以下にお使いのGmail情報を入力してください
// ==========================================
const GMAIL_USER = 'aqua030475@gmail.com'; // 例: admin@gmail.com
const GMAIL_APP_PASSWORD = 'mlgn nvuw hxvj dsso'; // 例: abcd efgh ijkl mnop (スペースはあってもなくても動作します)

// メール送信用のトランスポーター設定
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: GMAIL_USER,
        pass: GMAIL_APP_PASSWORD
    }
});

// 日報送信用のAPIエンドポイント
app.post('/api/send-report', async (req, res) => {
    const { toEmail, subject, text, staffName, date, visits } = req.body;

    try {
        const mailOptions = {
            from: GMAIL_USER,
            to: toEmail,
            subject: subject,
            text: text
        };

        // 実際のメール送信処理
        const info = await transporter.sendMail(mailOptions);
        console.log('✅ メールを送信しました:', info.response);

        // データベースに保存
        if (staffName && date && visits && Array.isArray(visits)) {
            const stmt = db.prepare(`INSERT INTO visits (staff_name, visit_date, time_range, location, duration, category) VALUES (?, ?, ?, ?, ?, ?)`);
            visits.forEach(v => {
                stmt.run(staffName, date, v.time, v.location, v.duration, v.category || '未設定');
            });
            stmt.finalize();
            console.log('✅ 訪問履歴をデータベースに保存しました。');
        }

        res.status(200).json({ success: true, message: '日報を送信し、データを保存しました。' });
    } catch (error) {
        console.error('❌ メールの送信に失敗しました:', error);
        res.status(500).json({ success: false, message: 'メール送信エラー', error: error.message });
    }
});

// スタッフアプリからの直接データ保存API
app.post('/api/save-visit', (req, res) => {
    const { staffName, date, visits } = req.body;
    
    if (!staffName || !date || !visits || !Array.isArray(visits)) {
        return res.status(400).json({ success: false, message: '必要なデータが不足しています。' });
    }

    try {
        const stmt = db.prepare(`INSERT INTO visits (staff_name, visit_date, time_range, location, duration, category) VALUES (?, ?, ?, ?, ?, ?)`);
        visits.forEach(v => {
            stmt.run(staffName, date, v.time, v.location, v.duration, v.category || '未設定');
        });
        stmt.finalize();
        
        console.log(`✅ [${staffName}] スタッフアプリから直接履歴を保存しました。`);
        res.status(200).json({ success: true, message: 'データベースへの保存が完了しました。' });
    } catch (error) {
        console.error('❌ 保存エラー:', error.message);
        res.status(500).json({ success: false, message: '保存エラー', error: error.message });
    }
});

// 訪問履歴の検索API
app.get('/api/visits', (req, res) => {
    const { staffName, date, patientName } = req.query;
    
    let query = `SELECT * FROM visits WHERE 1=1`;
    const params = [];

    if (staffName) {
        query += ` AND staff_name = ?`;
        params.push(staffName);
    }
    if (date) {
        query += ` AND visit_date = ?`;
        params.push(date);
    }
    if (patientName) {
        query += ` AND location LIKE ?`;
        params.push(`%${patientName}%`);
    }

    query += ` ORDER BY visit_date DESC, time_range ASC`;

    db.all(query, params, (err, rows) => {
        if (err) {
            console.error('❌ データベース検索エラー:', err.message);
            res.status(500).json({ success: false, message: 'データベース検索エラー', error: err.message });
        } else {
            res.status(200).json({ success: true, count: rows.length, data: rows });
        }
    });
});

// ==========================================
// 施設・患者管理API
// ==========================================

// 施設一覧と紐づく患者一覧を取得するAPI (StaffApp/AdminDashboard用)
app.get('/api/facilities', (req, res) => {
    db.all(`SELECT * FROM facilities ORDER BY created_at ASC`, [], (err, facilities) => {
        if (err) return res.status(500).json({ success: false, message: 'データベース検索エラー' });
        
        db.all(`SELECT * FROM patients ORDER BY created_at ASC`, [], (err, patients) => {
            if (err) return res.status(500).json({ success: false, message: 'データベース検索エラー' });
            
            // データを結合して返す
            const facilitiesWithPatients = facilities.map(f => {
                return {
                    id: f.id,
                    name: f.name,
                    lat: f.lat,
                    lng: f.lng,
                    isInside: false,
                    patients: patients.filter(p => p.facility_id === f.id).map(p => ({
                        id: p.id,
                        name: p.name,
                        room: p.room
                    }))
                };
            });
            res.status(200).json({ success: true, data: facilitiesWithPatients });
        });
    });
});

// 新規施設の追加API
app.post('/api/facilities', (req, res) => {
    const { id, name, lat, lng } = req.body;
    if (!id || !name || lat == null || lng == null) {
         return res.status(400).json({ success: false, message: '必要なデータが不足しています。' });
    }
    const stmt = db.prepare(`INSERT INTO facilities (id, name, lat, lng) VALUES (?, ?, ?, ?)`);
    stmt.run(id, name, lat, lng, function(err) {
        if (err) {
            console.error('施設追加エラー:', err.message);
            return res.status(500).json({ success: false, message: 'データベース保存エラー', error: err.message });
        }
        res.status(200).json({ success: true, message: '施設を追加しました。' });
    });
    stmt.finalize();
});

// 新規患者の追加API
app.post('/api/patients', (req, res) => {
    const { id, facility_id, name, room } = req.body;
    if (!id || !facility_id || !name || !room) {
         return res.status(400).json({ success: false, message: '必要なデータが不足しています。' });
    }
    const stmt = db.prepare(`INSERT INTO patients (id, facility_id, name, room) VALUES (?, ?, ?, ?)`);
    stmt.run(id, facility_id, name, room, function(err) {
        if (err) {
            console.error('患者追加エラー:', err.message);
            return res.status(500).json({ success: false, message: 'データベース保存エラー', error: err.message });
        }
        res.status(200).json({ success: true, message: '患者を追加しました。' });
    });
    stmt.finalize();
});

// サーバーの起動
app.listen(PORT, () => {
    console.log('=============================================');
    console.log(`🚀 サーバーが起動しました！ ポート: ${PORT}`);
    console.log(`   http://localhost:${PORT}/ にて待機中...`);
    console.log('=============================================');
});
