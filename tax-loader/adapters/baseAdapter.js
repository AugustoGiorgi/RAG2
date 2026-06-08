const path = require("path");
const fs = require("fs");

class BaseAdapter {
  constructor(config = {}) {
    this.config = config;
    this.software = "base";
  }

  loadFieldMap(entityType) {
    const file = path.join(__dirname, "..", "fieldMaps", `${this.software}_${entityType}.json`);
    if (!fs.existsSync(file)) throw new Error(`Missing field map: ${this.software}_${entityType}.json`);
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  }

  async prepare() {
    throw new Error("prepare() not implemented");
  }

  async load() {
    throw new Error("load() not implemented");
  }
}

module.exports = { BaseAdapter };
