const { Pool } = require('pg');

const pool = new Pool({
    connectionString: 'postgresql://neondb_owner:npg_5GElUHcJ0jVZ@ep-empty-scene-a4ickb0p.us-east-1.aws.neon.tech/neondb?sslmode=require',
    ssl: { rejectUnauthorized: false }
});

async function listFacilities() {
    try {
        const client = await pool.connect();
        const res = await client.query('SELECT * FROM facilities');
        console.log('Current Facilities:');
        console.table(res.rows);
        client.release();
    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await pool.end();
    }
}

listFacilities();
