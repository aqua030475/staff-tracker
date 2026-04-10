const { Pool } = require('pg');

const pool = new Pool({
    connectionString: 'postgresql://neondb_owner:npg_5GElUHcJ0jVZ@ep-empty-scene-a4ickb0p.us-east-1.aws.neon.tech/neondb?sslmode=require',
    ssl: { rejectUnauthorized: false }
});

const facilitiesToAdd = [
    { name: 'SOMPOケア ラヴィーレ名古屋', address: '愛知県名古屋市中村区黄金通6-1', lat: 35.158631, lng: 136.871302 },
    { name: '木場 清里苑', address: '愛知県名古屋市港区木場町1-11', lat: 35.111818, lng: 136.903808 }
];

async function register() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        console.log('--- 追加施設登録開始 ---');

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
        console.log('--- 追加施設登録完了 ---');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ エラー発生:', err.message);
    } finally {
        client.release();
        await pool.end();
    }
}

register();
