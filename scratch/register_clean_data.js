const fs = require('fs');
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: 'postgresql://neondb_owner:npg_5GElUHcJ0jVZ@ep-empty-scene-a4ickb0p.us-east-1.aws.neon.tech/neondb?sslmode=require',
    ssl: { rejectUnauthorized: false }
});

async function run() {
    const listContent = fs.readFileSync('施設一覧_utf8.csv', 'utf8');
    const addressContent = fs.readFileSync('アプリ住所_utf8.csv', 'utf8');

    // 1. Resolve Address/Location for Facilities
    const addressLines = addressContent.split('\n');
    const facilityInfoMap = {};

    addressLines.forEach(line => {
        const cols = line.split(',');
        if (cols.length >= 15) {
            const facName = cols[13] ? cols[13].trim() : null;
            const facAddr = cols[14] ? cols[14].trim() : null;
            if (facName && facAddr && !facilityInfoMap[facName]) {
                facilityInfoMap[facName] = { address: facAddr };
            }
        }
    });

    // 2. Parse Facility/Patient Mapping
    const listLines = listContent.split('\n');
    const data = [];
    let currentFacility = null;

    listLines.forEach(line => {
        const text = line.trim();
        if (text === '') {
            currentFacility = null;
        } else if (!currentFacility) {
            currentFacility = text;
            data.push({ facility: currentFacility, patients: [] });
        } else {
            const entry = data.find(d => d.facility === currentFacility);
            if (entry) entry.patients.push(text);
        }
    });

    // 3. Database Updates
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        console.log('--- データ登録開始 ---');

        for (const item of data) {
            const facName = item.facility;
            // 既存の施設情報を取得 (IDは住所または名前ベース)
            const facRes = await client.query('SELECT * FROM facilities WHERE name = $1', [facName]);
            
            let facId;
            let lat = 0, lng = 0;

            if (facRes.rows.length > 0) {
                facId = facRes.rows[0].id;
                lat = facRes.rows[0].lat;
                lng = facRes.rows[0].lng;
            } else {
                // 新規施設の場合、IDは名前を正規化したものなど
                facId = 'fac_' + Math.random().toString(36).substr(2, 9);
                // 住所情報があればそれを使う（経緯度は後で更新される想定かもが、一旦0で作成、または過去のDBに残っていればそちらを採用）
                await client.query('INSERT INTO facilities (id, name, lat, lng) VALUES ($1, $2, $3, $4)', [facId, facName, lat, lng]);
                console.log(`✅ 新規施設登録: ${facName}`);
            }

            // 患者の登録
            for (const pName of item.patients) {
                const patId = 'p_' + Math.random().toString(36).substr(2, 9);
                await client.query(
                    'INSERT INTO patients (id, facility_id, name, room, lat, lng) VALUES ($1, $2, $3, $4, $5, $6)',
                    [patId, facId, pName, '入居者', lat, lng]
                );
            }
            console.log(`✅ ${facName}: 患者 ${item.patients.length} 名を登録しました。`);
        }

        await client.query('COMMIT');
        console.log('--- 登録完了 ---');
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('❌ エラーが発生しました:', e);
    } finally {
        client.release();
        await pool.end();
    }
}

run();
