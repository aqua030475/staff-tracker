const express = require('express');
const nodemailer = require('nodemailer');
const cors = require('cors');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// PostgreSQL データベースの設定 (Neon)
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_5GElUHcJ0jVZ@ep-empty-scene-a4ickb0p.us-east-1.aws.neon.tech/neondb?sslmode=require',
    ssl: { rejectUnauthorized: false }
});

// 初期化処理
async function initDB() {
    try {
        const client = await pool.connect();
        console.log('✅ PostgreSQLデータベースに接続しました。');
        
        // uploads フォルダの作成
        const uploadDir = path.join(__dirname, 'uploads');
        if (!fs.existsSync(uploadDir)){
            fs.mkdirSync(uploadDir);
            console.log('✅ uploadsディレクトリを作成しました。');
        }

        // テーブル作成
        await client.query(`CREATE TABLE IF NOT EXISTS visits (
            id SERIAL PRIMARY KEY,
            staff_name TEXT,
            visit_date TEXT,
            time_range TEXT,
            location TEXT,
            duration TEXT,
            category TEXT,
            notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);

        await client.query(`CREATE TABLE IF NOT EXISTS visit_images (
            id SERIAL PRIMARY KEY,
            visit_id INTEGER,
            image_path TEXT,
            FOREIGN KEY (visit_id) REFERENCES visits(id) ON DELETE CASCADE
        )`);

        await client.query(`CREATE TABLE IF NOT EXISTS facilities (
            id TEXT PRIMARY KEY,
            name TEXT,
            lat REAL,
            lng REAL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
        
        await client.query(`CREATE TABLE IF NOT EXISTS patients (
            id TEXT PRIMARY KEY,
            facility_id TEXT,
            name TEXT,
            room TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (facility_id) REFERENCES facilities(id) ON DELETE CASCADE
        )`);
        
        await client.query(`CREATE TABLE IF NOT EXISTS staff (
            id TEXT PRIMARY KEY,
            name TEXT,
            role TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);

        await client.query(`CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        )`);

        // 初回起動時のスタッフ追加
        const staffRes = await client.query("SELECT COUNT(*) FROM staff");
        if (parseInt(staffRes.rows[0].count) === 0) {
            await client.query("INSERT INTO staff (id, name, role) VALUES ($1, $2, $3)", ['s1', '山田 太郎 医師', '医師']);
            await client.query("INSERT INTO staff (id, name, role) VALUES ($2, $3, $4)", ['s2', '伊藤 花子 看護師', '看護師']);
        }

        client.release();
        console.log('✅ 全てのテーブルの準備が完了しました。');
    } catch (err) {
        console.error('❌ データベースの初期化に失敗しました:', err.message);
    }
}

initDB();
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
            for (const v of visits) {
                await pool.query(
                    "INSERT INTO visits (staff_name, visit_date, time_range, location, duration, category) VALUES ($1, $2, $3, $4, $5, $6)",
                    [staffName, date, v.time, v.location, v.duration, v.category || '未設定']
                );
            }
            console.log('✅ 訪問履歴をデータベースに保存しました。');
        }

        res.status(200).json({ success: true, message: '日報を送信し、データを保存しました。' });
    } catch (error) {
        console.error('❌ メールの送信に失敗しました:', error);
        res.status(500).json({ success: false, message: 'メール送信エラー', error: error.message });
    }
});

// スタッフアプリからの直接データ保存API
app.post('/api/save-visit', async (req, res) => {
    const { staffName, date, visits } = req.body;
    
    if (!staffName || !date || !visits || !Array.isArray(visits)) {
        return res.status(400).json({ success: false, message: '必要なデータが不足しています。' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        for (const v of visits) {
            const visitResult = await client.query(
                "INSERT INTO visits (staff_name, visit_date, time_range, location, duration, category, notes) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id",
                [staffName, date, v.time, v.location, v.duration, v.category || '未設定', v.notes || '']
            );
            const visitId = visitResult.rows[0].id;
            
            // 画像の保存処理があれば実行
            if (v.images && Array.isArray(v.images)) {
                for (let index = 0; index < v.images.length; index++) {
                    const base64 = v.images[index];
                    const filename = `visit_${visitId}_${index}_${Date.now()}.jpg`;
                    const photoPath = saveBase64Image(base64, filename);
                    await client.query(
                        "INSERT INTO visit_images (visit_id, image_path) VALUES ($1, $2)",
                        [visitId, photoPath]
                    );
                }
            }
        }
        
        await client.query('COMMIT');
        console.log(`✅ [${staffName}] スタッフアプリから直接履歴(画像/メモ含む)を保存しました。`);
        res.status(200).json({ success: true, message: 'データベースへの保存が完了しました。' });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ 保存エラー:', error.message);
        res.status(500).json({ success: false, message: '保存エラー', error: error.message });
    } finally {
        client.release();
    }
});

// 訪問履歴の検索API (画像データも結合して取得)
app.get('/api/visits', async (req, res) => {
    const { staffName, date, patientName } = req.query;
    
    let query = `SELECT v.*, string_agg(i.image_path, ',') as images 
                 FROM visits v 
                 LEFT JOIN visit_images i ON v.id = i.visit_id 
                 WHERE 1=1`;
    const params = [];

    if (staffName) {
        params.push(staffName);
        query += ` AND v.staff_name = $${params.length}`;
    }
    if (date) {
        params.push(date);
        query += ` AND v.visit_date = $${params.length}`;
    }
    if (patientName) {
        params.push(`%${patientName}%`);
        query += ` AND v.location LIKE $${params.length}`;
    }

    query += ` GROUP BY v.id ORDER BY v.visit_date DESC, v.time_range ASC`;

    try {
        const result = await pool.query(query, params);
        const formattedRows = result.rows.map(r => ({
            ...r,
            images: r.images ? r.images.split(',') : []
        }));
        res.status(200).json({ success: true, count: formattedRows.length, data: formattedRows });
    } catch (err) {
        console.error('❌ データベース検索エラー:', err.message);
        res.status(500).json({ success: false, message: 'データベース検索エラー', error: err.message });
    }
});

// ==========================================
// 施設・患者管理API
// ==========================================

// 施設一覧と紐づく患者一覧を取得するAPI (StaffApp/AdminDashboard用)
app.get('/api/facilities', async (req, res) => {
    try {
        const facilitiesRes = await pool.query("SELECT * FROM facilities ORDER BY created_at ASC");
        const patientsRes = await pool.query("SELECT * FROM patients ORDER BY created_at ASC");
        
        const facilities = facilitiesRes.rows;
        const patients = patientsRes.rows;

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
    } catch (err) {
        console.error('施設・患者取得エラー:', err.message);
        res.status(500).json({ success: false, message: 'データベース検索エラー' });
    }
});

// 新規施設の追加API
app.post('/api/facilities', async (req, res) => {
    const { id, name, lat, lng } = req.body;
    if (!id || !name || lat == null || lng == null) {
         return res.status(400).json({ success: false, message: '必要なデータが不足しています。' });
    }
    try {
        await pool.query(
            "INSERT INTO facilities (id, name, lat, lng) VALUES ($1, $2, $3, $4)",
            [id, name, lat, lng]
        );
        res.status(200).json({ success: true, message: '施設を追加しました。' });
    } catch (err) {
        if (err.message.includes('unique constraint')) {
            return res.status(400).json({ success: false, message: 'この施設IDは既に使用されています。' });
        }
        res.status(500).json({ success: false, message: 'データベース保存エラー', error: err.message });
    }
});

// 新規患者の追加API
app.post('/api/patients', async (req, res) => {
    const { id, facility_id, name, room } = req.body;
    if (!id || !facility_id || !name || !room) {
         return res.status(400).json({ success: false, message: '必要なデータが不足しています。' });
    }
    try {
        await pool.query(
            "INSERT INTO patients (id, facility_id, name, room) VALUES ($1, $2, $3, $4)",
            [id, facility_id, name, room]
        );
        res.status(200).json({ success: true, message: '患者を追加しました。' });
    } catch (err) {
        if (err.message.includes('unique constraint')) {
            return res.status(400).json({ success: false, message: 'この患者IDは既に使用されています。' });
        }
        res.status(500).json({ success: false, message: 'データベース保存エラー', error: err.message });
    }
});

// 患者更新（所属施設の変更など）API
app.put('/api/patients/:id', async (req, res) => {
    const { id } = req.params;
    const { facility_id } = req.body;
    try {
        await pool.query(
            "UPDATE patients SET facility_id = $1 WHERE id = $2",
            [facility_id, id]
        );
        res.status(200).json({ success: true, message: '患者情報を更新しました。' });
    } catch (err) {
        console.error('患者更新エラー:', err.message);
        res.status(500).json({ success: false, message: '更新エラー' });
    }
});

// 施設削除API
app.delete('/api/facilities/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query("DELETE FROM facilities WHERE id = $1", [id]);
        res.status(200).json({ success: true, message: '施設を削除しました。' });
    } catch (err) {
        res.status(500).json({ success: false, message: '削除エラー' });
    }
});

// 患者削除API
app.delete('/api/patients/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query("DELETE FROM patients WHERE id = $1", [id]);
        res.status(200).json({ success: true, message: '患者を削除しました。' });
    } catch (err) {
        res.status(500).json({ success: false, message: '削除エラー' });
    }
});

// --- スタッフ用API ---
app.get('/api/staff', async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM staff ORDER BY created_at ASC");
        res.json({ success: true, data: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/staff', async (req, res) => {
    const { id, name, role } = req.body;
    if (!id || !name) return res.status(400).json({ success: false, message: '名前が必要です。' });
    
    try {
        await pool.query(
            "INSERT INTO staff (id, name, role) VALUES ($1, $2, $3)",
            [id, name, role || 'スタッフ']
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: '登録に失敗しました。' });
    }
});

app.delete('/api/staff/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query("DELETE FROM staff WHERE id = $1", [id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: '削除に失敗しました。' });
    }
});

// --- 設定用API ---
app.get('/api/settings', async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM settings");
        const settings = {};
        result.rows.forEach(r => settings[r.key] = r.value);
        res.json({ success: true, data: settings });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/settings', async (req, res) => {
    const { key, value } = req.body;
    try {
        await pool.query(
            "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2",
            [key, value]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: '保存に失敗しました。' });
    }
});

// 全データ消去用API（本番運用開始前のリセット用）
app.delete('/api/all', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(`DELETE FROM facilities`);
        await client.query(`DELETE FROM patients`);
        await client.query(`DELETE FROM visits`);
        await client.query('COMMIT');
        res.json({ success: true, message: 'すべてのデータを消去しました。' });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ success: false, message: '消去エラー' });
    } finally {
        client.release();
    }
});

// 一括インポート用API
app.post('/api/batch-import', async (req, res) => {
    const { items } = req.body;
    if (!items || !Array.isArray(items)) {
        return res.status(400).json({ success: false, message: 'データ形式が正しくありません。' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        for (const item of items) {
            const facId = 'f_' + Math.random().toString(36).substr(2, 9);
            const patId = 'p_' + Math.random().toString(36).substr(2, 9);
            const facName = `${item.patientName} 様`;
            
            await client.query(
                "INSERT INTO facilities (id, name, lat, lng) VALUES ($1, $2, $3, $4)",
                [facId, facName, item.lat, item.lng]
            );
            await client.query(
                "INSERT INTO patients (id, facility_id, name, room) VALUES ($1, $2, $3, $4)",
                [patId, facId, item.patientName, `〒${item.zip} ${item.address}`]
            );
        }
        await client.query('COMMIT');
        res.json({ success: true, message: `${items.length}件のデータをインポートしました。` });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ success: false, message: 'インポートエラー' });
    } finally {
        client.release();
    }
});

// サーバーの起動
app.listen(PORT, () => {
    console.log('=============================================');
    console.log(`🚀 サーバーが起動しました！ ポート: ${PORT}`);
    console.log(`   http://localhost:${PORT}/ にて待機中...`);
    console.log('=============================================');
});
