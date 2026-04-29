require('dotenv').config();
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
    ssl: { rejectUnauthorized: false },
    statement_timeout: 10000, // クエリが10秒以上かかる場合は強制終了（ハング防止）
    connectionTimeoutMillis: 5000 // 接続待ちが5秒以上の場合はタイムアウト
});

// Google Maps API Key
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

// 管理者用パスワード (環境変数から取得)
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

// 管理者認証ミドルウェア
const adminAuth = (req, res, next) => {
    // パスワードが設定されていない場合はスルー（開発用）
    if (!ADMIN_PASSWORD) return next();

    const providedPassword = req.headers['x-admin-password'];
    if (providedPassword === ADMIN_PASSWORD) {
        next();
    } else {
        res.status(401).json({ success: false, message: '認証エラー: 管理者パスワードが正しくありません。' });
    }
};

// --- Google Maps Geocoding Proxy (管理者認証) ---
app.post('/api/geocode', adminAuth, async (req, res) => {
    const { address } = req.body;
    if (!address) return res.status(400).json({ success: false, message: '住所が指定されていません' });

    if (!GOOGLE_MAPS_API_KEY || GOOGLE_MAPS_API_KEY === 'YOUR_API_KEY_HERE') {
        console.warn('⚠️ Google Maps API Key is missing in .env');
        return res.status(500).json({ success: false, message: 'Google APIキーが設定されていません' });
    }

    try {
        const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${GOOGLE_MAPS_API_KEY}&language=ja`;
        const response = await fetch(url);
        const data = await response.json();

        if (data.status === 'OK') {
            const location = data.results[0].geometry.location;
            res.json({
                success: true,
                lat: location.lat,
                lng: location.lng,
                formatted_address: data.results[0].formatted_address
            });
        } else {
            console.error('Google Geocoding API Error:', data.status, data.error_message);
            res.json({ success: false, message: `Google APIエラー: ${data.status}` });
        }
    } catch (error) {
        console.error('Geocoding Server Error:', error);
        res.status(500).json({ success: false, message: 'サーバー内エラーが発生しました' });
    }
});

// 初期化処理
async function initDB() {
    try {
        const client = await pool.connect();
        console.log('✅ PostgreSQLデータベースに接続しました。');
        
        // (注: 画像はEphemeral File System対策としてDBに直接保存するように変更)

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
            address TEXT,
            lat DOUBLE PRECISION,
            lng DOUBLE PRECISION,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);

        // カラム型の移行とカラム追加 (Migration)
        try {
            await client.query("ALTER TABLE facilities ALTER COLUMN lat TYPE DOUBLE PRECISION");
            await client.query("ALTER TABLE facilities ALTER COLUMN lng TYPE DOUBLE PRECISION");
            await client.query("ALTER TABLE facilities ADD COLUMN IF NOT EXISTS address TEXT");
        } catch (e) { }
        
        await client.query(`CREATE TABLE IF NOT EXISTS patients (
            id TEXT PRIMARY KEY,
            facility_id TEXT,
            name TEXT,
            room TEXT,
            lat DOUBLE PRECISION,
            lng DOUBLE PRECISION,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (facility_id) REFERENCES facilities(id) ON DELETE CASCADE
        )`);

        // 既存テーブルへのカラム追加 (Migration)
        try {
            await client.query("ALTER TABLE patients ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION");
            await client.query("ALTER TABLE patients ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION");
            await client.query("ALTER TABLE patients ADD COLUMN IF NOT EXISTS name_kana TEXT");
        } catch (e) { /* すでにある場合は無視 */ }
        
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

        // 初回起動時の初期データ追加
        const staffRes = await client.query("SELECT COUNT(*) FROM staff");
        if (parseInt(staffRes.rows[0].count) === 0) {
            await client.query("INSERT INTO staff (id, name, role) VALUES ($1, $2, $3)", ['s1', '山田 太郎 医師', '医師']);
            await client.query("INSERT INTO staff (id, name, role) VALUES ($1, $2, $3)", ['s2', '伊藤 花子 看護師', '看護師']);
        }
        
        // 「自宅」施設の追加
        const homeRes = await client.query("SELECT COUNT(*) FROM facilities WHERE id = 'home'");
        if (parseInt(homeRes.rows[0].count) === 0) {
            await client.query("INSERT INTO facilities (id, name, lat, lng) VALUES ($1, $2, $3, $4)", ['home', '自宅', 0, 0]);
        }

        client.release();
        await pool.query(`
            CREATE TABLE IF NOT EXISTS locations (
                id SERIAL PRIMARY KEY,
                staff_id TEXT,
                staff_name TEXT,
                lat DOUBLE PRECISION,
                lng DOUBLE PRECISION,
                timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
            )
        `);
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

// サーバーの起動 (Renderのタイムアウト防止：API定義前にまずポートを確保)
app.listen(PORT, () => {
    console.log('=============================================');
    console.log(`🚀 サーバーが起動しました！ ポート: ${PORT}`);
    console.log(`   http://localhost:${PORT}/ にて待機中...`);
    console.log('=============================================');
});

// ⚠️ 注: uploadsフォルダのマウントは廃止（直接DBからBase64提供に変更）

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
// 環境変数（Renderなど）で上書き可能な設定
// ==========================================
const GMAIL_USER = process.env.GMAIL_USER || 'aqua030475@gmail.com';
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD || 'mlgn nvuw hxvj dsso';

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

// 月別集計API
app.get('/api/stats/monthly', async (req, res) => {
    const { year, month } = req.query;
    if (!year || !month) return res.status(400).json({ success: false, message: '年と月を指定してください。' });

    try {
        // 指定された月の訪問回数を集計し、患者テーブルと結合してフリガナを取得
        const query = `
            WITH visit_patient_mapping AS (
                SELECT 
                    v.id,
                    v.location,
                    v.visit_date,
                    (
                        SELECT p.name 
                        FROM patients p 
                        WHERE 
                            v.location = p.name OR
                            v.location LIKE '%(' || p.name || ' 様)%' OR
                            v.location LIKE '%（' || p.name || ' 様）%'
                        LIMIT 1
                    ) as matched_name
                FROM visits v
                WHERE EXTRACT(YEAR FROM v.visit_date::date) = $1 
                  AND EXTRACT(MONTH FROM v.visit_date::date) = $2
            )
            SELECT 
                COALESCE(m.matched_name, m.location) as name, 
                MAX(p.name_kana) as name_kana,
                COUNT(DISTINCT m.visit_date) as count,
                COUNT(*) as total_records
            FROM visit_patient_mapping m
            LEFT JOIN patients p ON m.matched_name = p.name
            GROUP BY COALESCE(m.matched_name, m.location)
            ORDER BY name_kana ASC NULLS LAST, name ASC
        `;
        const result = await pool.query(query, [year, month]);
        res.json({ success: true, data: result.rows });
    } catch (error) {
        console.error('❌ 集計エラー:', error);
        res.status(500).json({ success: false, message: '集計中にエラーが発生しました。' });
    }
});

// AIによるカルテ清書APIエンドポイント
app.post('/api/format-medical-record', async (req, res) => {
    const { rawMemo, patientName } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;

    if (!rawMemo) {
        return res.status(400).json({ success: false, message: 'メモが空欄です' });
    }

    if (!apiKey) {
        return res.status(500).json({ success: false, message: 'サーバーにAI連携用のAPIキーが設定されていません' });
    }

    const prompt = `あなたはプロの鍼灸マッサージ師です。
提供された「音声入力メモ」を解析し、医師閲覧用の臨床記録に変換してください。

【変換ルール】
1. 「えー」「あのー」などの不要な語句は完全削除。
2. 「〜と言っている」「〜みたい」などの曖昧な表現、伝聞表現は「〜を自覚」「〜を認める」等の医学的客観表現、または体言止めに変換。
3. 挨拶や感想、今後の推奨は一切含めない。
4. 箇条書き（■）の形式を厳守。

【形式】
■施術前の状態
(内容)
■施術内容
(内容)
■施術後の変化
(内容)

【音声入力メモ】
${rawMemo}
(患者名: ${patientName || '不明'})`;

    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }]
            })
        });

        const data = await response.json();

        if (data.error) {
            console.error('Gemini API Error:', data.error);
            return res.status(500).json({ success: false, message: 'AIの解析中にエラーが発生しました', error: data.error.message });
        }

        const formattedText = data.candidates[0].content.parts[0].text;
        res.json({ success: true, formattedText });

    } catch (error) {
        console.error('AI Processing Error:', error);
        res.status(500).json({ success: false, message: '通信エラーが発生しました', error: error.message });
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
            const trimmedStaffName = staffName.trim();
            const visitResult = await client.query(
                "INSERT INTO visits (staff_name, visit_date, time_range, location, duration, category, notes) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id",
                [trimmedStaffName, date, v.time, v.location, v.duration, v.category || '未設定', v.notes || '']
            );
            const visitId = visitResult.rows[0].id;
            
            // 画像の保存処理があれば実行 (Base64を直接DBに保存する)
            if (v.images && Array.isArray(v.images)) {
                for (let index = 0; index < v.images.length; index++) {
                    const base64 = v.images[index];
                    await client.query(
                        "INSERT INTO visit_images (visit_id, image_path) VALUES ($1, $2)",
                        [visitId, base64]
                    );
                }
            }
        }
        
        await client.query('COMMIT');
        console.log(`✅ [${staffName}] スタッフアプリから直接履歴(画像/メモ含む)を保存しました。`);
        
        // Webhook連携 (Google Spreadsheet等への送信)
        try {
            const settingsResult = await pool.query("SELECT value FROM settings WHERE key = 'google_sheet_webhook_url'");
            if (settingsResult.rows.length > 0 && settingsResult.rows[0].value) {
                const webhookUrl = settingsResult.rows[0].value;
                // Node 20.x以降はfetchがデフォルト利用可能
                await fetch(webhookUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        staffName,
                        date,
                        visits: visits.map(v => ({
                            time: v.time,
                            location: v.location,
                            duration: v.duration,
                            category: v.category,
                            notes: v.notes,
                            imageCount: v.images ? v.images.length : 0
                        }))
                    })
                });
                console.log(`✅ Webhookを送信しました: ${webhookUrl}`);
            }
        } catch (webhookErr) {
            console.error('❌ Webhookの送信に失敗しました:', webhookErr.message);
        }

        res.status(200).json({ success: true, message: 'データベースへの保存が完了しました。' });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ 保存エラー:', error.message);
        res.status(500).json({ success: false, message: '保存エラー', error: error.message });
    } finally {
        client.release();
    }
});

// 指定した日の全データをスプレッドシートへ再出力するAPI
app.get('/api/export-sheet', adminAuth, async (req, res) => {
    const { date } = req.query;
    if (!date) return res.status(400).json({ success: false, message: '日付が必要です' });

    try {
        // Webhook URLを取得
        const settingsResult = await pool.query("SELECT value FROM settings WHERE key = 'google_sheet_webhook_url'");
        if (settingsResult.rows.length === 0 || !settingsResult.rows[0].value) {
            return res.status(400).json({ success: false, message: '設定画面でスプレッドシート連携URLを登録してください' });
        }
        const date = req.query.date;
        const targetStaffName = req.query.staffName; // 指定されたスタッフのみ書き出すためのオプション
        if (!date) return res.status(400).json({ success: false, message: '日付を指定してください' });

        // その日の訪問データを取得 (重複を除外し、最新の登録分のみを取得)
        let queryText = `
            SELECT DISTINCT ON (v.staff_name, v.time_range, v.location) v.*, string_agg(i.image_path, ',') as images 
            FROM visits v 
            LEFT JOIN visit_images i ON v.id = i.visit_id 
            WHERE v.visit_date = $1
        `;
        let queryParams = [date];

        if (targetStaffName) {
            queryText += ` AND v.staff_name = $2`;
            queryParams.push(targetStaffName);
        }

        queryText += ` GROUP BY v.id ORDER BY v.staff_name ASC, v.time_range ASC, v.location ASC, v.created_at DESC`;

        const visitsResult = await pool.query(queryText, queryParams);

        if (visitsResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: '該当日付のデータがありません' });
        }

        // 時刻文字列を比較用に正規化する関数 (8:51 -> 08:51, " 9:00" -> "09:00")
        const normalizeTime = (t) => {
            if (!t || typeof t !== 'string') return '99:99';
            const cleanT = t.trim();
            if (!cleanT) return '99:99';
            
            const timePart = cleanT.split(/[\s-]/)[0]; // "10:00 - 11:00" や "10:00" に対応
            const parts = timePart.split(':');
            if (parts.length < 2) return timePart.padStart(5, '0');
            return parts[0].padStart(2, '0') + ':' + parts[1].padStart(2, '0');
        };

        // 訪問データを一度すべて取得し、メモリ上で正確に並び替える
        const rawVisits = visitsResult.rows;

        // スタッフごとにデータをまとめて保持
        const grouped = {};
        rawVisits.forEach(r => {
            if (!grouped[r.staff_name]) {
                grouped[r.staff_name] = {
                    visits: [],
                    earliestTime: '99:99'
                };
            }
            const normTime = normalizeTime(r.time_range);
            if (normTime < grouped[r.staff_name].earliestTime) {
                grouped[r.staff_name].earliestTime = normTime;
            }
            grouped[r.staff_name].visits.push(r);
        });

        // スタッフのリストを「その日の最初の訪問時刻」順に並び替え
        const sortedStaffNames = Object.keys(grouped).sort((a, b) => {
            const timeA = grouped[a].earliestTime;
            const timeB = grouped[b].earliestTime;
            if (timeA !== timeB) return timeA.localeCompare(timeB);
            return a.localeCompare(b); // 時刻が同じなら名前順
        });

        console.log(`📊 Exporting data for ${date}:`, sortedStaffNames.map(name => `${name}(${grouped[name].earliestTime})`));

        // 並び替えた順に一つずつ送信 (await で確実に順番を守る)
        for (const staffName of sortedStaffNames) {
            const staffData = grouped[staffName];
            
            // スタッフ内の訪問データも時刻順にソート
            staffData.visits.sort((a, b) => {
                const tA = normalizeTime(a.time_range);
                const tB = normalizeTime(b.time_range);
                return tA.localeCompare(tB);
            });

            console.log(`   📤 Sending report for ${staffName}...`);
            await fetch(webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    staffName: staffName,
                    date: date,
                    visits: staffData.visits.map(v => ({
                        time: v.time_range,
                        location: v.location,
                        duration: v.duration,
                        category: v.category,
                        notes: v.notes
                    }))
                })
            });
        }

        res.json({ success: true, message: 'スプレッドシートへの出力が完了しました' });
    } catch (err) {
        console.error('Export Error:', err);
        res.status(500).json({ success: false, message: 'エクスポート中にエラーが発生しました' });
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
        params.push(staffName.trim());
        query += ` AND TRIM(v.staff_name) = $${params.length}`;
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

// 訪問記録の削除API (管理者認証)
app.delete('/api/visits/:id', adminAuth, async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query("DELETE FROM visits WHERE id = $1", [id]);
        res.status(200).json({ success: true, message: '訪問記録を削除しました。' });
    } catch (err) {
        console.error('❌ 訪問記録削除エラー:', err.message);
        res.status(500).json({ success: false, message: '削除エラー', error: err.message });
    }
});

// ==========================================
// 施設・患者管理API
// ==========================================

// 施設一覧と紐づく患者一覧を取得するAPI
app.get('/api/facilities', async (req, res) => {
    try {
        const facilitiesRes = await pool.query("SELECT * FROM facilities ORDER BY created_at ASC");
        const patientsRes = await pool.query("SELECT * FROM patients ORDER BY created_at ASC");
        
        const facilities = facilitiesRes.rows;
        const patients = patientsRes.rows;

        // 全員に全データ（患者名含む）を返す（スタッフアプリ動作用）
        const facilitiesWithPatients = facilities.map(f => {
            return {
                id: f.id,
                name: f.name,
                lat: f.lat,
                lng: f.lng,
                address: f.address,
                isInside: false,
                patients: patients.filter(p => p.facility_id === f.id).map(p => ({
                    id: p.id,
                    name: p.name,
                    room: p.room,
                    lat: p.lat,
                    lng: p.lng,
                    address: p.address
                }))
            };
        });
        res.status(200).json({ success: true, data: facilitiesWithPatients });
    } catch (err) {
        console.error('施設・患者取得エラー:', err.message);
        res.status(500).json({ success: false, message: 'データベース検索エラー' });
    }
});

// 全患者の一覧を取得するAPI (管理者認証)
app.get('/api/patients', adminAuth, async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM patients ORDER BY created_at ASC");
        res.status(200).json({ success: true, data: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, message: '患者一覧取得エラー' });
    }
});

// 新規施設の追加API (管理者認証)
app.post('/api/facilities', adminAuth, async (req, res) => {
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

// 新規患者の追加API (管理者認証)
app.post('/api/patients', adminAuth, async (req, res) => {
    const { id, facility_id, name, name_kana, room } = req.body;
    if (!id || !facility_id || !name || !room) {
         return res.status(400).json({ success: false, message: '必要なデータが不足しています。' });
    }
    try {
        await pool.query(
            "INSERT INTO patients (id, facility_id, name, name_kana, room) VALUES ($1, $2, $3, $4, $5)",
            [id, facility_id, name, name_kana || null, room]
        );
        res.status(200).json({ success: true, message: '患者を追加しました。' });
    } catch (err) {
        if (err.message.includes('unique constraint')) {
            return res.status(400).json({ success: false, message: 'この患者IDは既に使用されています。' });
        }
        res.status(500).json({ success: false, message: 'データベース保存エラー', error: err.message });
    }
});

// 患者更新API (管理者認証)
app.put('/api/patients/:id', adminAuth, async (req, res) => {
    const { id } = req.params;
    let { facility_id, name, room, lat, lng } = req.body;

    try {
        // もし施設が変更され、かつ新しい座標が直接指定されていない場合、移動先施設から現在の座標を取得して適用する
        if (facility_id && lat === undefined && lng === undefined) {
            const facRes = await pool.query("SELECT lat, lng FROM facilities WHERE id = $1", [facility_id]);
            if (facRes.rows.length > 0) {
                lat = facRes.rows[0].lat;
                lng = facRes.rows[0].lng;
                console.log(`📍 患者 [${id}] の移動に伴い、施設 [${facility_id}] の座標 (${lat}, ${lng}) を自動適用します。`);
            }
        }

        await pool.query(
            "UPDATE patients SET facility_id = COALESCE($1, facility_id), name = COALESCE($2, name), room = COALESCE($3, room), lat = COALESCE($4, lat), lng = COALESCE($5, lng) WHERE id = $6",
            [facility_id, name, room, lat || null, lng || null, id]
        );
        res.status(200).json({ success: true, message: '患者情報を更新しました。' });
    } catch (err) {
        console.error('❌ 患者更新エラー:', err.message);
        res.status(500).json({ success: false, message: '更新エラー' });
    }
});

// 施設更新 API
app.put('/api/facilities/:id', adminAuth, async (req, res) => {
    const { id } = req.params;
    const { name, address, lat, lng } = req.body;
    console.log(`🌐 施設更新リクエスト: ID=${id}, Address=${address}, Lat=${lat}, Lng=${lng}`);
    try {
        const result = await pool.query(
            "UPDATE facilities SET name = COALESCE($1, name), address = COALESCE($2, address), lat = COALESCE($3, lat), lng = COALESCE($4, lng) WHERE id = $5",
            [name, address, lat, lng, id]
        );
        res.status(200).json({ success: true, message: '施設情報を更新しました。' });
    } catch (err) {
        console.error('❌ 施設更新エラー:', err.message);
        res.status(500).json({ success: false, message: '更新エラー' });
    }
});

// 施設削除API (管理者認証)
app.delete('/api/facilities/:id', adminAuth, async (req, res) => {
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

// --- 位置情報（ルート）API ---

// 施設追加 API
app.post('/api/facilities', async (req, res) => {
    const { id, name, address, lat, lng } = req.body;
    try {
        await pool.query(
            "INSERT INTO facilities (id, name, address, lat, lng) VALUES ($1, $2, $3, $4, $5)", 
            [id, name, address, lat, lng]
        );
        res.status(200).json({ success: true, message: '施設を追加しました。' });
    } catch (err) {
        console.error('❌ 施設追加エラー:', err.message);
        res.status(500).json({ success: false, message: '登録エラー' });
    }
});

// 指定したスタッフ・日のルートを取得
app.get('/api/location', async (req, res) => {
    const { staff_id, date } = req.query;
    try {
        const query = `
            SELECT lat, lng, timestamp 
            FROM locations 
            WHERE staff_id = $1 
            AND (timestamp AT TIME ZONE 'Asia/Tokyo')::date = $2::date 
            ORDER BY timestamp ASC
        `;
        const result = await pool.query(query, [staff_id, date]);
        res.status(200).json({ success: true, data: result.rows });
    } catch (err) {
        console.error('位置情報取得エラー:', err.message);
        res.status(500).json({ success: false });
    }
});

// スタッフからの位置情報を受信して保存
app.post('/api/location', async (req, res) => {
    const { staff_id, staff_name, lat, lng } = req.body;
    if (!staff_id || lat === undefined || lng === undefined) {
        return res.status(400).json({ success: false, message: 'データが不完全です' });
    }

    try {
        await pool.query(
            "INSERT INTO locations (staff_id, staff_name, lat, lng) VALUES ($1, $2, $3, $4)",
            [staff_id, staff_name || '不明', lat, lng]
        );
        res.status(200).json({ success: true });
    } catch (err) {
        console.error('位置情報保存エラー:', err.message);
        res.status(500).json({ success: false });
    }
});

// --- スタッフ用API ---
app.get('/api/staff', async (req, res) => {
    try {
        // 各スタッフの最新の位置情報取得時間を結合し、15分以内ならアクティブと判定
        const query = `
            SELECT s.*, 
                   (SELECT MAX(timestamp) FROM locations WHERE staff_id = s.id) as last_seen,
                   EXISTS (
                       SELECT 1 FROM locations 
                       WHERE staff_id = s.id 
                       AND timestamp > NOW() - INTERVAL '15 minutes'
                   ) as is_active
            FROM staff s 
            ORDER BY s.created_at ASC
        `;
        const result = await pool.query(query);
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


