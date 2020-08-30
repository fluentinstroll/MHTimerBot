const sqlite3= require('sqlite3');
const Logger = require('../modules/logger');
const CommandResult = require('../interfaces/command-result');
const db_file = 'data/trade.db';
let connected = false;
let db;
const db_version = 1.00;

// https://dbdiagram.io/d/5f4c15e588d052352cb558f6

/**
 * Opens the trade database, calls out to upgrade it if needed
 * @returns {Promise<boolean>}
 */
async function initialize() {
    if (connected) {
        return true;
    }
    connected = true; // In case someone immediately tries to connect again
    db = new sqlite3.Database(db_file, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
        if (err) {
            Logger.error(`Error opening database: ${err}`);
            connected = false;
        }
        Logger.log('Trade database opened');
    });
    // Get the current version in the database
    db.prepare('CREATE TABLE IF NOT EXISTS version (version REAL)').run().finalize();
    let current_version = 0.00;
    db.all('SELECT version FROM version', [], (err, rows) => {
        if (err) {
            console.error(`TRADE: Error reading version: ${err}`);
            throw err; // re-throw it, I guess?
        }
        if (rows.length)
            current_version = rows[0][0];
        if (current_version < db_version)
            do_upgrade(current_version);
    });
    return true;
}

/**
 * Upgrades the database from the version supplied
 * @param {Number} current_version The current version of the database. The starting point
 */
function do_upgrade(current_version) {
    current_version = current_version || 0.00;
    if (!db) {
        Logger.error('TRADE: Database no open, I cannot upgrade it');
        throw new TypeError('Database not open, cannot be upgraded, cannot be opened');
    }
    if (current_version < 1.00) {
        //Brand new database
        db.run('CREATE TABLE trader (discord_id TEXT, hunter_id TEXT, last_seen TEXT, blocked INTEGER)');
    }
}

module.exports.initialize = initialize;