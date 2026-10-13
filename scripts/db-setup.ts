// Creates tables and seeds demo accounts in the database pointed to by DATABASE_URL
// (or the local PGlite store). Safe to run repeatedly.
import { getDb } from '../src/lib/db'

getDb()
  .then(async (db) => {
    const [{ count }] = await db.query<{ count: string }>('SELECT count(*) AS count FROM users')
    console.log(`Database ready. ${count} users present.`)
    process.exit(0)
  })
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
