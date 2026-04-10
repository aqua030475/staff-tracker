const { Pool } = require('pg');

const pool = new Pool({
    connectionString: 'postgresql://neondb_owner:npg_5GElUHcJ0jVZ@ep-empty-scene-a4ickb0p.us-east-1.aws.neon.tech/neondb?sslmode=require',
    ssl: { rejectUnauthorized: false }
});

async function unify() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const facs = (await client.query('SELECT * FROM facilities')).rows;
        
        // 類似名を正規化するためのヘルパー
        const normalize = (name) => name.replace(/[ 　\s]/g, '').replace(/[－-]/g, '-').replace(/[（）()]/g, '');

        const pairs = [
            { old: 'そんぽの家 植田西', new: 'そんぽの家　植田西' },
            { old: 'そんぽの家Ｓ瑞穂公園', new: 'そんぽの家瑞穂公園' },
            { old: 'そんぽの家Ｓ瑞穂公園', new: 'そんぽの家　瑞穂公園' },
            { old: 'エイジフリー・ハウス名古屋上社', new: 'エイジフリ－ハウス名古屋上社' },
            { old: 'ココファン名古屋富士見', new: 'ココファン富士見' },
            { old: '木場 清里苑', new: '清里苑' },
            { old: 'ポンセジュール徳重', new: 'ボンセジュール徳重' }
        ];

        for (const pair of pairs) {
            const oldFac = facs.find(f => f.name === pair.old);
            const newFac = facs.find(f => f.name === pair.new);

            if (oldFac && newFac && oldFac.id !== newFac.id) {
                console.log(`Merging ${newFac.name} (${newFac.id}) into ${oldFac.name} (${oldFac.id})`);
                // 患者を移動
                await client.query('UPDATE patients SET facility_id = $1 WHERE facility_id = $2', [oldFac.id, newFac.id]);
                // 重複した空の施設を削除
                await client.query('DELETE FROM facilities WHERE id = $1', [newFac.id]);
            }
        }

        // 位置情報が0の施設を検索してジオコーディング（既知の場所をセット）
        const updates = [
            { name: 'そんぽの家　黄金', lat: 35.1524, lng: 136.8711 } // 黄金駅周辺
        ];

        for (const u of updates) {
            await client.query('UPDATE facilities SET lat = $1, lng = $2 WHERE name = $3 AND lat = 0', [u.lat, u.lng, u.name]);
        }

        await client.query('COMMIT');
        console.log('Unification completed.');
    } catch (e) {
        await client.query('ROLLBACK');
        console.error(e);
    } finally {
        client.release();
        await pool.end();
    }
}

unify();
