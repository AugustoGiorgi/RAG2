# Tax Loader

`tax-loader` takes an approved RAG Tax AI Excel workpaper, maps the rows to canonical tax keys, validates CPA review flags, and generates a load artifact for either CCH Axcess or Drake.

It is intentionally standalone. The existing app can call this module after the human reviewer approves the generated workpaper.

## Supported Returns

- Form 1040
- Form 1065
- Form 1120
- Form 1120-S

## Software Targets

- CCH Axcess: prepares an API payload and contains the OAuth/client/return/input flow. Official endpoint paths and field names are placeholders marked `REQUIERE-DOC-OFICIAL`.
- Drake: for 1065, 1120, and 1120-S, fills the official Drake 2025 Trial Balance templates from `C:\DRAKE25\TB` and writes an Excel file back to that folder. For 1040, it still generates a Schedule C style CSV fallback until the official 1040 import template is mapped.

## Workpaper Contract

The approved workbook must include a `Cover` sheet with key/value rows:

```text
Client | Acme Holdings LLC
EIN    | 82-1234567
Entity | 1120-S
Year   | 2025
```

Each data sheet must have headers in one of the first five rows:

```text
canonical_key | tax_amount | flag | CPA Notes
```

Allowed flags:

- `ok`: load normally
- `review`: load, but validation emits a warning
- `manual`: do not include in the artifact; validation emits a warning
- `error`: block loading until resolved

Unknown canonical keys are ignored and logged as warnings.

## Install

```bash
cd tax-loader
npm install
```

## Test

```bash
npm test
```

The test creates sample workpapers for 1040, 1065, 1120, and 1120-S, parses them, validates flags, and generates both CCH and Drake artifacts without touching real services.

## Example Usage

```javascript
const { TaxLoader } = require("./tax-loader");

async function run() {
  const loader = new TaxLoader({
    drake: {
      companionUrl: "http://127.0.0.1:7777",
      companionToken: process.env.COMPANION_TOKEN,
    },
    cch_axcess: {
      clientId: process.env.CCH_CLIENT_ID,
      clientSecret: process.env.CCH_CLIENT_SECRET,
      apiKey: process.env.CCH_API_KEY,
    },
  });

  const data = await loader.parseWorkpaper("approved_workpaper.xlsx");
  const validation = loader.validate(data);

  if (!validation.ok) {
    console.log(validation.blockers);
    return;
  }

  const artifact = await loader.generateFileOnly("drake", data);
  console.log(artifact.filename);
}

run();
```

## Drake Companion

For Drake, run the companion on the CPA workstation:

```bash
cd tax-loader/companion
set COMPANION_TOKEN=replace-with-a-long-secret
set DRAKE_IMPORT_DIR=C:\DRAKE25\TB
node companion.js
```

Then call:

```javascript
await loader.load("drake", data);
```

The companion writes the CSV file only. The CPA imports it using Drake's official import workflow.

For business returns, the companion uses Microsoft Excel COM automation to copy and fill Drake's own `.TBI` template:

- `1120`: `C:\DRAKE25\TB\CRPTEMP.TBI`, sheet `Corp TB`
- `1120-S`: `C:\DRAKE25\TB\SBSTEMP.TBI`, sheet `SBS TB`
- `1065`: `C:\DRAKE25\TB\PTRTEMP.TBI`, sheet `PTR TB`

After the file is created, open the target return in Drake and use:

```text
Import > Trial Balance Import > Next > select the generated *_TB_*.xls file
```

This matches Drake's official workflow: RAG Tax AI prepares the Excel trial balance file, and Drake imports it through its own import utility.

## Important Pending Items

See `PENDING.md`. The CCH endpoints, CCH field IDs, any unmapped Drake template rows, and the 1040-specific Drake import path must be completed from official documentation before production use.
