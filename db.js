// db.js
const { Pool } = require("pg");
const dns = require("dns");

// Hard-force IPv4 only for all connections made by 'pg'
const ipv4Lookup = (hostname, options, callback) => {
  return dns.lookup(hostname, { ...options, family: 4, all: false }, callback);
};

const connectionString = process.env.DATABASE_URL;

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false }, // keep SSL on for Supabase/managed DBs
  lookup: ipv4Lookup,                 // <-- this is the key line
  // Optional tuning:
  // max: 5,
  // idleTimeoutMillis: 10000,
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
