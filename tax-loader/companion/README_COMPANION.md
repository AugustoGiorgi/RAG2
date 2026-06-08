# Tax Loader Companion

The companion is only needed for Drake. CCH Axcess uses the cloud API path and does not require this local process.

## What It Does

The companion receives a prepared artifact from `tax-loader` and writes it to a local Drake import folder. For 1065, 1120, and 1120-S, it opens Drake's own `.TBI` trial balance template through Microsoft Excel COM automation, fills the mapped rows, and saves the completed workbook as `.xls` in `C:\DRAKE25\TB`.

It does not automate the Drake user interface and it does not scrape anything. The CPA still imports the generated file using Drake's official import workflow.

## Start

```bash
set COMPANION_TOKEN=replace-with-a-long-secret
set DRAKE_IMPORT_DIR=C:\DRAKE25\TB
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

`DRAKE_IMPORT_DIR` must be updated with the actual folder used by the CPA's Drake installation. For the local Drake 2025 trial installation, the detected folder is:

```text
C:\DRAKE25\TB
```

The companion expects Microsoft Excel to be installed locally because Drake's Trial Balance Import also requires Excel.

After a workbook is generated, open Drake, open the target business return, and select:

```text
Import > Trial Balance Import
```

Then browse to the generated `*_TB_*.xls` file.
