![Logo](admin/tidy.svg)

## tidy adapter for ioBroker

![Number of Installations](https://iobroker.live/badges/tidy-installed.svg)
![Current version in stable repository](https://iobroker.live/badges/tidy-stable.svg)
[![NPM Version](https://nodei.co/npm/iobroker.tidy.svg?style=shields&data=v,u,d&color=orange)](https://www.npmjs.com/package/iobroker.tidy)
[![Downloads](https://img.shields.io/npm/dm/iobroker.tidy.svg)](https://www.npmjs.com/package/iobroker.tidy)

[![Paypal Donation](https://img.shields.io/badge/paypal-donate%20|%20spenden-green.svg)](https://www.paypal.com/donate/?hosted_button_id=7W6M3TFZ4W9LW)

## What this adapter does

The **Tidy** adapter analyzes your ioBroker instance for unused, outdated, or orphaned datapoints. After years of using ioBroker, your system may accumulate "dead" datapoints from deleted scripts, removed adapters, or abandoned configurations. This adapter helps you identify and clean up such datapoints to keep your system tidy and performant.

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
    "id": "0_userdata.0.flur.licht_auto",
    "name": "Lichtautomatik Flur",
    "last_ts": 1712856000000,
    "last_ts_iso": "11.04.2026 18:00",
    "value": true,
    "status": "active",
    "issue": null,
    "size": 4
  },
  {
    "id": "0_userdata.0.test.alter_wert",
    "name": "Testdatenpunkt",
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
| `name` | common.name | User-friendly name |
| `last_ts` | state.ts (timestamp as number) | Sorting in background |
| `last_ts_iso` | Formatted date string | Display in table |
| `issue` | `dead`, `orphaned_alias`, `stale`, or `null` | Filter criterion for "corpses" |
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

1. Create a table widget in VIS
2. Bind it to `tidy.0.userdata.result`
3. Configure columns: id, name, last_ts_iso, issue
4. Sort by `last_ts` (oldest first) to find the "deadest" datapoints

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

### **WORK IN PROGRESS**
- (skvarel) Initial implementation with core features
- (skvarel) Added path-based scanning for multiple root paths (0_userdata.0, alias.0, etc.)
- (skvarel) Implemented smart detection for dead, stale, and orphaned datapoints
- (skvarel) Added configurable age thresholds for stale/dead detection
- (skvarel) Implemented automatic scanning with configurable intervals
- (skvarel) Added manual trigger buttons for on-demand scans
- (skvarel) Created JSON table output for VIS integration
- (skvarel) Implemented orphaned alias detection (ghost aliases)

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