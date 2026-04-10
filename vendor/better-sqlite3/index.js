'use strict';

const { DatabaseSync } = require('node:sqlite');

class BetterSqlite3Compat {
  constructor(filename) {
    const location = filename === ':memory:' ? ':memory:' : filename;
    this._db = new DatabaseSync(location);
  }

  pragma(statement) {
    this._db.exec(`PRAGMA ${statement}`);
  }

  exec(sql) {
    this._db.exec(sql);
  }

  prepare(sql) {
    const stmt = this._db.prepare(sql);
    return {
      run: (paramsOrFirst, ...rest) => {
        if (rest.length > 0) return stmt.run(paramsOrFirst, ...rest);
        if (paramsOrFirst != null && typeof paramsOrFirst === 'object' && !Array.isArray(paramsOrFirst)) return stmt.run(paramsOrFirst);
        if (Array.isArray(paramsOrFirst)) return stmt.run(...paramsOrFirst);
        if (paramsOrFirst === undefined) return stmt.run();
        return stmt.run(paramsOrFirst);
      },
      get: (paramsOrFirst, ...rest) => {
        if (rest.length > 0) return stmt.get(paramsOrFirst, ...rest);
        if (paramsOrFirst != null && typeof paramsOrFirst === 'object' && !Array.isArray(paramsOrFirst)) return stmt.get(paramsOrFirst);
        if (Array.isArray(paramsOrFirst)) return stmt.get(...paramsOrFirst);
        if (paramsOrFirst === undefined) return stmt.get();
        return stmt.get(paramsOrFirst);
      },
      all: (paramsOrFirst, ...rest) => {
        if (rest.length > 0) return stmt.all(paramsOrFirst, ...rest);
        if (paramsOrFirst != null && typeof paramsOrFirst === 'object' && !Array.isArray(paramsOrFirst)) return stmt.all(paramsOrFirst);
        if (Array.isArray(paramsOrFirst)) return stmt.all(...paramsOrFirst);
        if (paramsOrFirst === undefined) return stmt.all();
        return stmt.all(paramsOrFirst);
      }
    };
  }

  transaction(fn) {
    return (...args) => {
      this.exec('BEGIN');
      try {
        const result = fn(...args);
        this.exec('COMMIT');
        return result;
      } catch (error) {
        this.exec('ROLLBACK');
        throw error;
      }
    };
  }
}

module.exports = BetterSqlite3Compat;
