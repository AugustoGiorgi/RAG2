const { BaseAdapter } = require("./baseAdapter");
const CCH = require("../config/cchEndpoints");

function assertConfigured(value, label) {
  if (!value || String(value).startsWith("REQUIERE-DOC-OFICIAL")) {
    throw new Error(`${label} requires official CCH documentation/configuration.`);
  }
}

function pathWithParams(path, params) {
  return Object.entries(params).reduce(
    (output, [key, value]) => output.replace(`{${key}}`, encodeURIComponent(value)),
    path
  );
}

class CCHAxcessAdapter extends BaseAdapter {
  constructor(config = {}) {
    super(config);
    this.software = "cch_axcess";
    this.token = null;
  }

  async authenticate() {
    assertConfigured(CCH.baseUrl, "CCH baseUrl");
    assertConfigured(CCH.oauth.tokenPath, "CCH OAuth tokenPath");
    const response = await fetch(`${CCH.baseUrl}${CCH.oauth.tokenPath}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: CCH.oauth.grantType,
        client_id: this.config.clientId || "",
        client_secret: this.config.clientSecret || "",
        scope: CCH.oauth.scope,
      }),
    });
    if (!response.ok) throw new Error(`CCH auth failed: ${response.status} ${await response.text()}`);
    this.token = (await response.json()).access_token;
    return this.token;
  }

  async headers() {
    if (!this.token) await this.authenticate();
    const headers = { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" };
    if (this.config.apiKey) headers["X-Api-Key"] = this.config.apiKey;
    return headers;
  }

  async resolveClient(data) {
    assertConfigured(CCH.paths.clientsSearch, "CCH clientsSearch");
    const headers = await this.headers();
    const searchUrl = `${CCH.baseUrl}${pathWithParams(CCH.paths.clientsSearch, { ein: data.client.ein })}`;
    const search = await fetch(searchUrl, { headers });
    const found = search.ok ? await search.json() : { items: [] };
    if (Array.isArray(found.items) && found.items.length) return found.items[0].id;

    assertConfigured(CCH.paths.clientsCreate, "CCH clientsCreate");
    const created = await fetch(`${CCH.baseUrl}${CCH.paths.clientsCreate}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: data.client.name, ein: data.client.ein, entityType: data.client.entityType }),
    });
    if (!created.ok) throw new Error(`CCH create client failed: ${await created.text()}`);
    return (await created.json()).id;
  }

  async createReturn(clientId, data) {
    assertConfigured(CCH.paths.returnsCreate, "CCH returnsCreate");
    const response = await fetch(`${CCH.baseUrl}${CCH.paths.returnsCreate}`, {
      method: "POST",
      headers: await this.headers(),
      body: JSON.stringify({ clientId, taxYear: data.taxYear, entityType: data.client.entityType, status: "draft" }),
    });
    if (!response.ok) throw new Error(`CCH create return failed: ${await response.text()}`);
    return (await response.json()).id;
  }

  async prepare(data) {
    const fieldMap = this.loadFieldMap(data.client.entityType);
    const inputFields = [];
    const skipped = [];
    for (const field of data.fields || []) {
      if (field.flag === "manual" || field.flag === "error") {
        skipped.push(field.canonicalKey);
        continue;
      }
      const mapped = fieldMap.map[field.canonicalKey];
      if (!mapped) {
        skipped.push(field.canonicalKey);
        continue;
      }
      inputFields.push({
        form: mapped.form,
        field: mapped.field,
        line: mapped.line,
        value: field.value,
        canonicalKey: field.canonicalKey,
      });
    }
    return {
      kind: "api_payload",
      software: "cch_axcess",
      content: { fields: inputFields },
      meta: { fieldCount: inputFields.length, skipped },
    };
  }

  async load(artifact, data) {
    const errors = [];
    const warnings = [];
    await this.authenticate();
    const clientId = await this.resolveClient(data);
    const returnId = await this.createReturn(clientId, data);
    assertConfigured(CCH.paths.returnInput, "CCH returnInput");
    const method = CCH.methods.returnInput && !String(CCH.methods.returnInput).startsWith("REQUIERE-DOC-OFICIAL")
      ? CCH.methods.returnInput
      : "PATCH";
    const response = await fetch(`${CCH.baseUrl}${pathWithParams(CCH.paths.returnInput, { id: returnId })}`, {
      method,
      headers: await this.headers(),
      body: JSON.stringify(artifact.content),
    });
    if (!response.ok) errors.push(`CCH return input failed: ${await response.text()}`);

    let diagnostics = [];
    try {
      assertConfigured(CCH.paths.diagnostics, "CCH diagnostics");
      const diagnosticResponse = await fetch(`${CCH.baseUrl}${pathWithParams(CCH.paths.diagnostics, { id: returnId })}`, {
        headers: await this.headers(),
      });
      if (diagnosticResponse.ok) diagnostics = (await diagnosticResponse.json()).items || [];
    } catch (error) {
      warnings.push(`diagnostics skipped: ${error.message}`);
    }
    if (artifact.meta.skipped.length) warnings.push(`${artifact.meta.skipped.length} manual/skipped fields: ${artifact.meta.skipped.join(", ")}`);
    return {
      success: errors.length === 0,
      fieldsLoaded: artifact.meta.fieldCount,
      errors,
      warnings,
      auditTrail: { software: "cch_axcess", clientId, returnId, taxYear: data.taxYear, diagnostics, timestamp: new Date().toISOString() },
    };
  }
}

module.exports = { CCHAxcessAdapter };
