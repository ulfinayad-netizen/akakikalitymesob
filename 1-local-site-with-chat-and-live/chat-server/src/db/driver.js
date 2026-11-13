"use strict";
function tryBetterSqlite() {
  try {
    const Database = require("better-sqlite3");
    new Database(":memory:").close();
    return Database;
  } catch {
    return null;
  }
}
function nodeSqliteDriver() {
  let DatabaseSync;
  try {
    ({ DatabaseSync } = require("node:sqlite"));
  } catch {
    throw new Error(
      "No SQLite driver available: better-sqlite3 could not be loaded and this Node.js has no built-in node:sqlite. Use Node.js 22.13 or newer (or install the C++ build tools so better-sqlite3 can compile)."
    );
  }
  return class Database {
    constructor(file) {
      this.raw = new DatabaseSync(file);
      this.depth = 0;
    }
    exec(sql) {
      this.raw.exec(sql);
      return this;
    }
    pragma(text) {
      this.raw.exec(`PRAGMA ${text}`);
    }
    prepare(sql) {
      const st = this.raw.prepare(sql);
      return {
        get: (...args) => st.get(...args),
        all: (...args) => st.all(...args),
        run: (...args) => st.run(...args)
      };
    }
    transaction(fn) {
      return (...args) => {
        const outer = this.depth === 0;
        const name = `sp${this.depth}`;
        this.raw.exec(outer ? "BEGIN" : `SAVEPOINT ${name}`);
        this.depth += 1;
        try {
          const result = fn(...args);
          this.depth -= 1;
          this.raw.exec(outer ? "COMMIT" : `RELEASE ${name}`);
          return result;
        } catch (err) {
          this.depth -= 1;
          this.raw.exec(outer ? "ROLLBACK" : `ROLLBACK TO ${name}; RELEASE ${name}`);
          throw err;
        }
      };
    }
    close() {
      this.raw.close();
    }
  };
}
module.exports = tryBetterSqlite() || nodeSqliteDriver();
