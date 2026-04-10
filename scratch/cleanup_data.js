const { Pool } = require('pg');

const pool = new Pool({
    connectionString: 'postgresql://neondb_owner:npg_5GElUHcJ0jVZ@ep-empty-scene-a4ickb0p.us-east-1.aws.neon.tech/neondb?sslmode=require',
    ssl: { rejectUnauthorized: false }
});

async function cleanup() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Delete all patients
        await client.query('DELETE FROM patients');
        console.log('Deleted all patients.');

        // Delete specific facilities
        const facilitiesToDelete = [
            'てんぱくの宿 芝生公園',
            'てんぱくの宿 松並公園',
            'そんぽの家 菅田',
            'グランダ東山'
        ];

        for (const name of facilitiesToDelete) {
            const res = await client.query('DELETE FROM facilities WHERE name = $1', [name]);
            if (res.rowCount > 0) {
                console.log(`Deleted facility: ${name}`);
            }
        }

        await client.query('COMMIT');
        console.log('Cleanup completed successfully.');
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('Error during cleanup:', e);
    } finally {
        client.release();
        await pool.end();
    }
}

cleanup();
