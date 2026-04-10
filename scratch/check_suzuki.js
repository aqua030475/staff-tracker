const { Pool } = require('pg');
// removed dotenv

const pool = new Pool({
    connectionString: 'postgresql://neondb_owner:npg_5GElUHcJ0jVZ@ep-empty-scene-a4ickb0p.us-east-1.aws.neon.tech/neondb?sslmode=require',
});

async function check() {
    try {
        const res = await pool.query(`
            SELECT p.name, p.facility_id, f.name as facility_name, p.lat, p.lng, f.lat as f_lat, f.lng as f_lng
            FROM patients p
            LEFT JOIN facilities f ON p.facility_id = f.id
            WHERE p.name LIKE '%鈴木%' OR p.name LIKE '%和子%'
        `);
        console.log('--- Patient Data Check ---');
        console.table(res.rows);
    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}

check();
