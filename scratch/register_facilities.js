const { Pool } = require('pg');

const pool = new Pool({
    connectionString: 'postgresql://neondb_owner:npg_5GElUHcJ0jVZ@ep-empty-scene-a4ickb0p.us-east-1.aws.neon.tech/neondb?sslmode=require',
    ssl: { rejectUnauthorized: false }
});

const facilitiesToAdd = [
    { name: 'アイシア吹上', address: '愛知県名古屋市千種区今池3-17-21', lat: 35.1706, lng: 136.9329 },
    { name: 'グランダ南山', address: '愛知県名古屋市昭和区五軒家町18-9', lat: 35.1432, lng: 136.9489 },
    { name: 'ココファン名古屋富士見', address: '愛知県名古屋市中区富士見町6-30', lat: 35.1554, lng: 136.9161 },
    { name: '八事苑', address: '愛知県名古屋市天白区大坪2-801', lat: 35.1368, lng: 136.9818 },
    { name: 'ポンセジュール徳重', address: '愛知県名古屋市緑区黒沢台5-1309-1', lat: 35.0931, lng: 136.9998 },
    { name: 'まどか名城公園', address: '愛知県名古屋市北区金城1-7-31', lat: 35.1873, lng: 136.9066 }
];

async function register() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        console.log('--- 施設登録開始 ---');

        for (const f of facilitiesToAdd) {
            // 施設が存在するか確認
            const checkRes = await client.query('SELECT id FROM facilities WHERE id = $1', [f.address]);
            if (checkRes.rows.length === 0) {
                await client.query(
                    'INSERT INTO facilities (id, name, lat, lng) VALUES ($1, $2, $3, $4)',
                    [f.address, f.name, f.lat, f.lng]
                );
                console.log(`✅ 施設追加: ${f.name}`);

                // ダミー患者の追加
                const patId = 'p_' + Math.random().toString(36).substr(2, 9);
                await client.query(
                    'INSERT INTO patients (id, facility_id, name, room) VALUES ($1, $2, $3, $4)',
                    [patId, f.address, `${f.name} 入居者`, '101号室']
                );
                console.log(`   └ 患者追加: ${f.name} 入居者`);
            } else {
                console.log(`⚠️ 施設は既に存在します: ${f.name}`);
            }
        }

        await client.query('COMMIT');
        console.log('--- 施設登録完了 ---');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ エラー発生:', err.message);
    } finally {
        client.release();
        await pool.end();
    }
}

register();
