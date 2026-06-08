# Pending Official Information

This module is implemented up to the point where official CCH Axcess and Drake documentation is required. Values marked `REQUIERE-DOC-OFICIAL` must not be guessed.

## CCH Axcess

Get these from the CCH Axcess Developer Portal after obtaining the Open Integration Platform license from Wolters Kluwer:

- Real API base URL and API version.
- Exact OAuth endpoint, grant type, and scopes.
- Real paths for client search, client creation, return creation, return input, and diagnostics.
- HTTP method and request body schema for return input.
- Real field mapping values for each return type:
  - `fieldMaps/cch_axcess_1040.json`
  - `fieldMaps/cch_axcess_1065.json`
  - `fieldMaps/cch_axcess_1120.json`
  - `fieldMaps/cch_axcess_1120S.json`

Each CCH field map currently contains the canonical keys and placeholder `form`, `field`, and `line` values.

## Drake

Get these from official Drake documentation or downloadable Drake import templates from `kb.drakesoftware.com`:

- Official Schedule C / applicable individual import template for 1040.
- Additional row mappings for any Drake Trial Balance template lines not yet covered by the canonical map.
- Review whether 1120-S officer compensation should map to shareholder or non-shareholder officer rows on a per-client basis.
- Confirm whether 1065 guaranteed payments should map to services or capital on a per-client basis.
- Complete any optional Drake detail sheets that should be populated beyond the main Trial Balance sheet.
- Confirm production install folder if the client is not using Drake 2025 at `C:\DRAKE25`.

Detected and implemented for local Drake 2025 trial:

- `1120`: `C:\DRAKE25\TB\CRPTEMP.TBI`, sheet `Corp TB`
- `1120-S`: `C:\DRAKE25\TB\SBSTEMP.TBI`, sheet `SBS TB`
- `1065`: `C:\DRAKE25\TB\PTRTEMP.TBI`, sheet `PTR TB`
- Companion writes completed workbooks to `C:\DRAKE25\TB`

## RAG Tax AI Workpaper Generator

The existing workpaper generator must output:

- A `Cover` sheet with client name, EIN or SSN, entity type, and tax year.
- A `canonical_key` column on every data sheet that should be loadable.
- A `tax_amount` column with the final CPA-approved amount.
- A `flag` column using `ok`, `review`, `manual`, or `error`.

## Canonical Key Expansion

`lib/canonical.js` contains the first loadable canonical vocabulary for 1040, 1065, 1120, and 1120-S. Add more keys when the real workpapers produce additional loadable fields, then update all eight field maps with the matching software placeholders or official values.
