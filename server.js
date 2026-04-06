const express = require('express');
const nodemailer = require('nodemailer');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// SQLite データベースの設定
const db = new sqlite3.Database('./database.sqlite', (err) => {
    if (err) {
        console.error('データベースの接続に失敗しました:', err.message);
    } else {
        console.log('✅ SQLiteデータベースに接続しました。');
        
        // uploads フォルダの作成
        const uploadDir = path.join(__dirname, 'uploads');
        if (!fs.existsSync(uploadDir)){
            fs.mkdirSync(uploadDir);
            console.log('✅ uploadsディレクトリを作成しました。');
        }

        // visits テーブルの作成
        db.run(`CREATE TABLE IF NOT EXISTS visits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            staff_name TEXT,
            visit_date TEXT,
            time_range TEXT,
            location TEXT,
            duration TEXT,
            category TEXT,
            notes TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`, (err) => {
            if (err) {
                console.error('テーブルの作成に失敗しました:', err.message);
            } else {
                console.log('✅ visitsテーブルの準備が完了しました。');
                db.run(`ALTER TABLE visits ADD COLUMN category TEXT`, () => {});
                db.run(`ALTER TABLE visits ADD COLUMN notes TEXT`, () => {});
            }
        });

        // visit_images テーブルの作成
        db.run(`CREATE TABLE IF NOT EXISTS visit_images (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            visit_id INTEGER,
            image_path TEXT,
            FOREIGN KEY (visit_id) REFERENCES visits(id)
        )`, (err) => {
            if (err) console.error('visit_imagesテーブルの作成に失敗しました:', err.message);
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
            )`);
        });
    }
});
// ミドルウェアの設定（JSONのサイズ制限を緩和し、画像を扱えるようにする）
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(__dirname)); // ローカルHTMLファイルの配信用
app.use('/uploads', express.static(path.join(__dirname, 'uploads'))); // アップロード画像の配信用

// --- ページ（HTML）のルート設定 ---
// ブラウザで https://xxx.onrender.com/ にアクセスしたとき
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'AdminDashboardMockup.html'));
});

// ブラウザで https://xxx.onrender.com/admin にアクセスしたとき
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'AdminDashboardMockup.html'));
});

// ブラウザで https://xxx.onrender.com/staff にアクセスしたとき（スマホ用）
app.get('/staff', (req, res) => {
    res.sendFile(path.join(__dirname, 'StaffAppMockup.html'));
});

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

// 画像保存用のユーティリティ関数
const saveBase64Image = (base64Data, filename) => {
    const base64Image = base64Data.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Image, 'base64');
    const filePath = path.join(__dirname, 'uploads', filename);
    fs.writeFileSync(filePath, buffer);
    return `/uploads/${filename}`;
};

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
        db.serialize(() => {
            const stmt = db.prepare(`INSERT INTO visits (staff_name, visit_date, time_range, location, duration, category, notes) VALUES (?, ?, ?, ?, ?, ?, ?)`);
            const imgStmt = db.prepare(`INSERT INTO visit_images (visit_id, image_path) VALUES (?, ?)`);
            
            visits.forEach(v => {
                stmt.run(staffName, date, v.time, v.location, v.duration, v.category || '未設定', v.notes || '', function(err) {
                    if (err) {
                        console.error('Visit保存エラー:', err);
                        return;
                    }
                    const visitId = this.lastID;
                    
                    // 画像の保存処理があれば実行
                    if (v.images && Array.isArray(v.images)) {
                        v.images.forEach((base64, index) => {
                            const filename = `visit_${visitId}_${index}_${Date.now()}.jpg`;
                            const photoPath = saveBase64Image(base64, filename);
                            imgStmt.run(visitId, photoPath);
                        });
                    }
                });
            });
            stmt.finalize();
            imgStmt.finalize();
        });
        
        console.log(`✅ [${staffName}] スタッフアプリから直接履歴(画像/メモ含む)を保存しました。`);
        res.status(200).json({ success: true, message: 'データベースへの保存が完了しました。' });
    } catch (error) {
        console.error('❌ 保存エラー:', error.message);
        res.status(500).json({ success: false, message: '保存エラー', error: error.message });
    }
});

// 訪問履歴の検索API (画像データも結合して取得)
app.get('/api/visits', (req, res) => {
    const { staffName, date, patientName } = req.query;
    
    let query = `SELECT v.*, GROUP_CONCAT(i.image_path) as images 
                 FROM visits v 
                 LEFT JOIN visit_images i ON v.id = i.visit_id 
                 WHERE 1=1`;
    const params = [];

    if (staffName) {
        query += ` AND v.staff_name = ?`;
        params.push(staffName);
    }
    if (date) {
        query += ` AND v.visit_date = ?`;
        params.push(date);
    }
    if (patientName) {
        query += ` AND v.location LIKE ?`;
        params.push(`%${patientName}%`);
    }

    query += ` GROUP BY v.id ORDER BY v.visit_date DESC, v.time_range ASC`;

    db.all(query, params, (err, rows) => {
        if (err) {
            console.error('❌ データベース検索エラー:', err.message);
            res.status(500).json({ success: false, message: 'データベース検索エラー', error: err.message });
        } else {
            // images を文字列から配列に変換
            const formattedRows = rows.map(r => ({
                ...r,
                images: r.images ? r.images.split(',') : []
            }));
            res.status(200).json({ success: true, count: formattedRows.length, data: formattedRows });
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
            if (err.message.includes('UNIQUE')) {
                return res.status(400).json({ success: false, message: 'この施設IDは既に使用されています。別のID（例: f3 など）をお試しください。' });
            }
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
            if (err.message.includes('UNIQUE')) {
                return res.status(400).json({ success: false, message: 'この患者IDは既に使用されています。別のIDを指定してください。' });
            }
            return res.status(500).json({ success: false, message: 'データベース保存エラー', error: err.message });
        }
        res.status(200).json({ success: true, message: '患者を追加しました。' });
    });
    stmt.finalize();
});

// 施設削除API
app.delete('/api/facilities/:id', (req, res) => {
    const { id } = req.params;
    db.run(`DELETE FROM facilities WHERE id = ?`, [id], function(err) {
        if (err) {
            console.error('施設削除エラー:', err.message);
            return res.status(500).json({ success: false, message: '削除エラー' });
        }
        res.status(200).json({ success: true, message: '施設を削除しました。' });
    });
});

// 患者削除API
app.delete('/api/patients/:id', (req, res) => {
    const { id } = req.params;
    db.run(`DELETE FROM patients WHERE id = ?`, [id], function(err) {
        if (err) {
            console.error('患者削除エラー:', err.message);
            return res.status(500).json({ success: false, message: '削除エラー' });
        }
        res.status(200).json({ success: true, message: '患者を削除しました。' });
    });
});

// 全データ消去用API（本番運用開始前のリセット用）
app.delete('/api/all', (req, res) => {
    db.serialize(() => {
        db.run(`DELETE FROM facilities`);
        db.run(`DELETE FROM patients`);
        db.run(`DELETE FROM visits`);
        res.json({ success: true, message: 'すべてのデータを消去しました。' });
    });
});

// 一括インポート用API
app.post('/api/batch-import', (req, res) => {
    const { items } = req.body; // [{ patientName, address, lat, lng, zip }]
    
    if (!items || !Array.isArray(items)) {
        return res.status(400).json({ success: false, message: 'データ形式が正しくありません。' });
    }

    db.serialize(() => {
        const stmtFac = db.prepare(`INSERT INTO facilities (id, name, lat, lng) VALUES (?, ?, ?, ?)`);
        const stmtPat = db.prepare(`INSERT INTO patients (id, facility_id, name, room) VALUES (?, ?, ?, ?)`);

        items.forEach(item => {
            const facId = 'f_' + Math.random().toString(36).substr(2, 9);
            const patId = 'p_' + Math.random().toString(36).substr(2, 9);
            
            // 施設名をお客様名（〇〇様）にする
            const facName = `${item.patientName} 様`;
            
            stmtFac.run(facId, facName, item.lat, item.lng);
            stmtPat.run(patId, facId, item.patientName, `〒${item.zip} ${item.address}`);
        });

        stmtFac.finalize();
        stmtPat.finalize();
        
        res.json({ 
            success: true, 
            message: `${items.length}件のデータをインポートしました。` 
        });
    });
});

// サーバーの起動
app.listen(PORT, () => {
    console.log('=============================================');
    console.log(`🚀 サーバーが起動しました！ ポート: ${PORT}`);
    console.log(`   http://localhost:${PORT}/ にて待機中...`);
    console.log('=============================================');
});
