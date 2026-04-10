const { Pool } = require('pg');

const pool = new Pool({
    connectionString: 'postgresql://neondb_owner:npg_5GElUHcJ0jVZ@ep-empty-scene-a4ickb0p.us-east-1.aws.neon.tech/neondb?sslmode=require',
    ssl: { rejectUnauthorized: false }
});

async function alignment() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        console.log('--- 位置データの同期を開始します ---');

        // 施設ごとの位置情報を取得
        const facilities = (await client.query('SELECT id, lat, lng FROM facilities')).rows;
        
        for (const fac of facilities) {
            // その施設に紐づいている患者の位置を一括更新
            const res = await client.query(
                "UPDATE patients SET lat = $1, lng = $2 WHERE facility_id = $3",
                [fac.lat, fac.lng, fac.id]
            );
            if (res.rowCount > 0) {
                console.log(`✅ 施設 [${fac.id}] の患者 ${res.rowCount} 名の位置情報を更新しました。`);
            }
        }

        await client.query('COMMIT');
        console.log('--- 同期完了 ---');
    } catch (e) {
        await client.query('ROLLBACK');
        console.error(e);
    } finally {
        client.release();
        await pool.end();
    }
}

alignment();
