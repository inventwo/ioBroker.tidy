![Logo](admin/tidy.svg)

## tidy adapter for ioBroker

![Number of Installations](https://iobroker.live/badges/tidy-installed.svg)
![Current version in stable repository](https://iobroker.live/badges/tidy-stable.svg)
[![NPM Version](https://nodei.co/npm/iobroker.tidy.svg?style=shields&data=v,u,d&color=orange)](https://www.npmjs.com/package/iobroker.tidy)
[![Downloads](https://img.shields.io/npm/dm/iobroker.tidy.svg)](https://www.npmjs.com/package/iobroker.tidy)

[![Paypal Donation](https://img.shields.io/badge/paypal-donate%20|%20spenden-green.svg)](https://www.paypal.com/donate/?hosted_button_id=7W6M3TFZ4W9LW)

## What this adapter does

The **Tidy** adapter helps to find unused objects and states to clean up your system. After years of using ioBroker, your system may accumulate "dead" datapoints from deleted scripts, removed adapters, or abandoned configurations. This adapter helps you identify and clean up such datapoints to keep your system tidy and performant.

## Features

- **📊 Path-based scanning**: Configure multiple paths to scan (e.g., `0_userdata.0`, `alias.0`)
- **🔍 Smart detection**: Identifies different types of problematic datapoints:
  - **Dead**: Never updated or extremely old (configurable threshold, default: 365 days)
  - **Stale**: Not updated recently (configurable threshold, default: 90 days)
  - **Orphaned aliases**: Aliases pointing to non-existent target datapoints
  - **Undefined**: Datapoints that were never written to since system start
- **⚙️ Flexible configuration**: 
  - Configurable age thresholds for "stale" and "dead" detection
  - Optional automatic scanning at configurable intervals (hourly)
  - Enable/disable individual scan paths
- **🎯 Manual triggers**: Each configured path gets a trigger button to run scans on demand
- **📋 JSON table output**: Results are provided as JSON arrays, perfect for table widgets in VIS
- **📈 Statistics**: Automatic counters for total, dead, stale, and orphaned datapoints

## Configuration

### General Settings

- **Enable automatic scans**: When enabled, all configured paths are scanned automatically
- **Scan interval**: How often automatic scans should run (in hours, minimum 1)
- **Days until 'stale'**: Datapoints not updated for this many days are marked as stale (warning)
- **Days until 'dead'**: Datapoints not updated for this many days are marked as dead (critical)

### Scan Paths

Configure one or more paths to monitor:

- **Enabled**: Enable/disable this scan path
- **Path**: The root path to scan (e.g., `0_userdata.0`, `alias.0`, `javascript.0`)
- **Name**: A friendly name for this path (used for result state naming)
- **Check alias targets**: For `alias.*` paths, check if target datapoints still exist (ghost detection)

## Data Points

For each configured path (e.g., "userdata"), the adapter creates:

- **`tidy.0.userdata.trigger`** (button): Click to manually start a scan
- **`tidy.0.userdata.result`** (json): Complete scan results as JSON table
- **`tidy.0.userdata.lastScan`** (timestamp): When the last scan was performed
- **`tidy.0.userdata.count`** (number): Total datapoints found
- **`tidy.0.userdata.deadCount`** (number): Number of dead datapoints
- **`tidy.0.userdata.staleCount`** (number): Number of stale datapoints
- **`tidy.0.userdata.orphanedCount`** (number): Number of orphaned aliases

### JSON Result Structure

The `result` state contains a JSON array with the following fields for each datapoint:

```json
[
  {
    "id": "0_userdata.0.hallway.light_auto",
    "name": "Hallway Light Automation",
    "last_ts": 1712856000000,
    "last_ts_iso": "4/11/2026, 6:00:00 PM",
    "value": true,
    "status": "active",
    "issue": null,
    "size": 4
  },
  {
    "id": "0_userdata.0.test.old_value",
    "name": "Test Datapoint",
    "last_ts": null,
    "last_ts_iso": "undefined",
    "value": 15,
    "status": "undefined",
    "issue": "dead",
    "size": 2
  }
]
```

**Field descriptions:**

| Field | Description | Purpose |
|-------|-------------|---------|
| `id` | Full datapoint path | Unique identification |
| `name` | common.name or last part of ID | User-friendly name |
| `last_ts` | Unix timestamp (ms) or null | Sorting in background |
| `last_ts_iso` | Formatted date string | Display in table |
| `value` | Current datapoint value | Final check before deletion |
| `status` | `active`, `dead`, `stale`, `undefined`, `orphaned` | Classification (English) |
| `status_de` | `aktiv`, `inaktiv`, `veraltet`, `undefiniert`, `verwaist` | Classification (German) |
| `issue` | `dead`, `stale`, `orphaned_alias`, or `null` | Filter criterion (null = OK) |
| `issue_de` | `inaktiv`, `veraltet`, `verwaistes Alias`, or `null` | Filter criterion (German) |
| `size` | `JSON.stringify(val).length` | Finds "storage hogs" |

## Usage Examples

### Basic Setup

1. Install and configure the adapter
2. Add a path to scan (e.g., `0_userdata.0`)
3. Give it a name (e.g., "userdata")
4. Save configuration
5. The adapter will immediately perform an initial scan
6. View results in `tidy.0.userdata.result`

### VIS Integration

Use the JSON result with a table widget to display and sort your datapoints:

1. Create a table widget in VIS (e.g., inventwo Table Widget)
2. Bind it to `tidy.0.userdata.result`
3. Configure columns:
   - For **German** tables: `id`, `name`, `last_ts_iso`, `status_de`, `issue_de`
   - For **English** tables: `id`, `name`, `last_ts_iso`, `status`, `issue`
4. Sort by `last_ts` (oldest first) to find the "deadest" datapoints
5. Filter by `issue != null` to show only problematic datapoints

### Automatic Maintenance

1. Enable "automatic scans" in settings
2. Set interval to 24 hours (once daily)
3. Monitor `deadCount` and `staleCount` statistics
4. Review results weekly to identify cleanup candidates

## Support

If you like our work and would like to support us, we appreciate any donation.
(This link leads to our PayPal account and is not affiliated with ioBroker.)

[![Donate](img/support.png)](https://www.paypal.com/donate?hosted_button_id=7W6M3TFZ4W9LW)

## Changelog
<!--
	### **WORK IN PROGRESS**
-->
### 0.1.1 (2026-04-18)
- (skvarel) Changed name of result field to optional
- (skvarel) Revised config

### 0.1.0 (2026-04-17)
- (skvarel) Added option for complete scan

### 0.0.1 (2026-04-14)
- (skvarel) initial release

## Older changes
- [CHANGELOG_OLD.md](CHANGELOG_OLD.md)

## License

MIT License

Copyright (c) 2026 skvarel <skvarel@inventwo.com>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.