# Tax Loader Companion

The companion is only needed for Drake. CCH Axcess uses the cloud API path and does not require this local process.

## What It Does

The companion receives a prepared CSV artifact from `tax-loader` and writes it to a local Drake import folder. It does not automate the Drake user interface and it does not scrape anything. The CPA still imports the generated file using Drake's official import workflow.

## Start

```bash
set COMPANION_TOKEN=replace-with-a-long-secret
set DRAKE_IMPORT_DIR=C:\DrakeXX\Import
node companion.js
```

The default URL is:

```text
http://127.0.0.1:7777
```

Health check:

```bash
curl http://127.0.0.1:7777/health
```

## Required Drake Information

`DRAKE_IMPORT_DIR` must be updated with the actual folder used by the CPA's Drake installation. The exact CSV columns, file naming, and import folder are still marked `REQUIERE-DOC-OFICIAL` until the official Drake import templates are available.
