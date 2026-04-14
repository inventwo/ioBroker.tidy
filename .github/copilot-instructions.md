# ioBroker Adapter Development with GitHub Copilot

**Version:** 0.5.7  
**Template Source:** https://github.com/DrozmotiX/ioBroker-Copilot-Instructions

This file contains instructions and best practices for GitHub Copilot when working on ioBroker adapter development.

---

## 📑 Table of Contents

1. [Project Context](#project-context)
2. [Code Quality & Standards](#code-quality--standards)
   - [Code Style Guidelines](#code-style-guidelines)
   - [ESLint Configuration](#eslint-configuration)
3. [Testing](#testing)
   - [Unit Testing](#unit-testing)
   - [Integration Testing](#integration-testing)
   - [API Testing with Credentials](#api-testing-with-credentials)
4. [Development Best Practices](#development-best-practices)
   - [Dependency Management](#dependency-management)
   - [HTTP Client Libraries](#http-client-libraries)
   - [Error Handling](#error-handling)
5. [Admin UI Configuration](#admin-ui-configuration)
   - [JSON-Config Setup](#json-config-setup)
   - [Translation Management](#translation-management)
6. [Documentation](#documentation)
   - [README Updates](#readme-updates)
   - [Changelog Management](#changelog-management)
7. [CI/CD & GitHub Actions](#cicd--github-actions)
   - [Workflow Configuration](#workflow-configuration)
   - [Testing Integration](#testing-integration)

---

## Project Context

You are working on an ioBroker adapter. ioBroker is an integration platform for the Internet of Things, focused on building smart home and industrial IoT solutions. Adapters are plugins that connect ioBroker to external systems, devices, or services.

This adapter connects ioBroker to the [Life360](https://www.life360.com) cloud service for family location tracking and geo-presence detection. It is a community fork of the original `ioBroker.life360` adapter, renamed to `life360ng` (next generation).

**Key characteristics:**
- Token-based authentication only (no password/phone login — Life360 disabled this for EU users)
- Polls the Life360 REST API at a configurable interval using Node.js native `https`
- Supports Life360 circles, members, places and geo-presence detection
- Supports custom private places (not visible to Life360 cloud) defined in the adapter config
- Optionally forwards location data to the ioBroker `places` adapter
- Uses `jsonConfig` for the admin UI (no compiled React frontend)
- Written in plain JavaScript (no TypeScript compilation step)
- EU users require bearer token obtained manually from browser DevTools
- Connection type: cloud / poll
- Main files: `main.js` (adapter), `lib/life360CloudConnector.js` (API), `lib/life360DbConnector.js` (state management), `lib/iobHelpers.js` (utilities)

---

## Code Quality & Standards

### Code Style Guidelines

- Follow JavaScript/TypeScript best practices
- Use async/await for asynchronous operations
- Implement proper resource cleanup in `unload()` method
- Use semantic versioning for adapter releases
- Include proper JSDoc comments for public methods

**Timer and Resource Cleanup Example:**
```javascript
private connectionTimer?: NodeJS.Timeout;

async onReady() {
  this.connectionTimer = setInterval(() => this.checkConnection(), 30000);
}

onUnload(callback) {
  try {
    if (this.connectionTimer) {
      clearInterval(this.connectionTimer);
      this.connectionTimer = undefined;
    }
    callback();
  } catch (e) {
    callback();
  }
}
```

### ESLint Configuration

**CRITICAL:** ESLint validation must run FIRST in your CI/CD pipeline, before any other tests. This "lint-first" approach catches code quality issues early.

#### Setup
```bash
npm install --save-dev eslint @iobroker/eslint-config
```

#### Configuration (.eslintrc.json)
```json
{
  "extends": "@iobroker/eslint-config",
  "rules": {
    // Add project-specific rule overrides here if needed
  }
}
```

#### Package.json Scripts
```json
{
  "scripts": {
    "lint": "eslint --max-warnings 0 .",
    "lint:fix": "eslint . --fix"
  }
}
```

#### Best Practices
1. ✅ Run ESLint before committing — fix ALL warnings, not just errors
2. ✅ Use `lint:fix` for auto-fixable issues
3. ✅ Don't disable rules without documentation
4. ✅ Lint all relevant files (main code, tests, build scripts)
5. ✅ Keep `@iobroker/eslint-config` up to date
6. ✅ **ESLint warnings are treated as errors in CI** (`--max-warnings 0`). The `lint` script above already includes this flag — run `npm run lint` to match CI behavior locally

#### Common Issues
- **Unused variables**: Remove or prefix with underscore (`_variable`)
- **Missing semicolons**: Run `npm run lint:fix`
- **Indentation**: Use 4 spaces (ioBroker standard)
- **console.log**: Replace with `adapter.log.debug()` or remove

---

## Testing

### Unit Testing

- Use Jest as the primary testing framework
- Create tests for all adapter main functions and helper methods
- Test error handling scenarios and edge cases
- Mock external API calls and hardware dependencies
- For adapters connecting to APIs/devices not reachable by internet, provide example data files

**Example Structure:**
```javascript
describe('AdapterName', () => {
  let adapter;
  
  beforeEach(() => {
    // Setup test adapter instance
  });
  
  test('should initialize correctly', () => {
    // Test adapter initialization
  });
});
```

### Integration Testing

**CRITICAL:** Use the official `@iobroker/testing` framework. This is the ONLY correct way to test ioBroker adapters.

**Official Documentation:** https://github.com/ioBroker/testing

#### Framework Structure

**✅ Correct Pattern:**
```javascript
const path = require('path');
const { tests } = require('@iobroker/testing');

tests.integration(path.join(__dirname, '..'), {
    defineAdditionalTests({ suite }) {
        suite('Test adapter with specific configuration', (getHarness) => {
            let harness;

            before(() => {
                harness = getHarness();
            });

            it('should configure and start adapter', function () {
                return new Promise(async (resolve, reject) => {
                    try {
                        // Get adapter object
                        const obj = await new Promise((res, rej) => {
                            harness.objects.getObject('system.adapter.your-adapter.0', (err, o) => {
                                if (err) return rej(err);
                                res(o);
                            });
                        });
                        
                        if (!obj) return reject(new Error('Adapter object not found'));

                        // Configure adapter
                        Object.assign(obj.native, {
                            position: '52.520008,13.404954',
                            createHourly: true,
                        });

                        harness.objects.setObject(obj._id, obj);
                        
                        // Start and wait
                        await harness.startAdapterAndWait();
                        await new Promise(resolve => setTimeout(resolve, 15000));

                        // Verify states
                        const stateIds = await harness.dbConnection.getStateIDs('your-adapter.0.*');
                        
                        if (stateIds.length > 0) {
                            console.log('✅ Adapter successfully created states');
                            await harness.stopAdapter();
                            resolve(true);
                        } else {
                            reject(new Error('Adapter did not create any states'));
                        }
                    } catch (error) {
                        reject(error);
                    }
                });
            }).timeout(40000);
        });
    }
});
```

#### Testing Success AND Failure Scenarios

**IMPORTANT:** For every "it works" test, implement corresponding "it fails gracefully" tests.

**Failure Scenario Example:**
```javascript
it('should NOT create daily states when daily is disabled', function () {
    return new Promise(async (resolve, reject) => {
        try {
            harness = getHarness();
            const obj = await new Promise((res, rej) => {
                harness.objects.getObject('system.adapter.your-adapter.0', (err, o) => {
                    if (err) return rej(err);
                    res(o);
                });
            });
            
            if (!obj) return reject(new Error('Adapter object not found'));

            Object.assign(obj.native, {
                createDaily: false, // Daily disabled
            });

            await new Promise((res, rej) => {
                harness.objects.setObject(obj._id, obj, (err) => {
                    if (err) return rej(err);
                    res(undefined);
                });
            });

            await harness.startAdapterAndWait();
            await new Promise((res) => setTimeout(res, 20000));

            const stateIds = await harness.dbConnection.getStateIDs('your-adapter.0.*');
            const dailyStates = stateIds.filter((key) => key.includes('daily'));
            
            if (dailyStates.length === 0) {
                console.log('✅ No daily states found as expected');
                resolve(true);
            } else {
                reject(new Error('Expected no daily states but found some'));
            }

            await harness.stopAdapter();
        } catch (error) {
            reject(error);
        }
    });
}).timeout(40000);
```

#### Key Rules

1. ✅ Use `@iobroker/testing` framework
2. ✅ Configure via `harness.objects.setObject()`
3. ✅ Start via `harness.startAdapterAndWait()`
4. ✅ Verify states via `harness.states.getState()`
5. ✅ Allow proper timeouts for async operations
6. ❌ NEVER test API URLs directly
7. ❌ NEVER bypass the harness system

#### Workflow Dependencies

Integration tests should run ONLY after lint and adapter tests pass:

```yaml
integration-tests:
  needs: [check-and-lint, adapter-tests]
  runs-on: ubuntu-22.04
```

### API Testing with Credentials

For adapters connecting to external APIs requiring authentication:

#### Password Encryption for Integration Tests

```javascript
async function encryptPassword(harness, password) {
    const systemConfig = await harness.objects.getObjectAsync("system.config");
    if (!systemConfig?.native?.secret) {
        throw new Error("Could not retrieve system secret for password encryption");
    }
    
    const secret = systemConfig.native.secret;
    let result = '';
    for (let i = 0; i < password.length; ++i) {
        result += String.fromCharCode(secret[i % secret.length].charCodeAt(0) ^ password.charCodeAt(i));
    }
    return result;
}
```

#### Demo Credentials Testing Pattern

- Use provider demo credentials when available (e.g., `demo@api-provider.com` / `demo`)
- Create separate test file: `test/integration-demo.js`
- Add npm script: `"test:integration-demo": "mocha test/integration-demo --exit"`
- Implement clear success/failure criteria

**Example Implementation:**
```javascript
it("Should connect to API with demo credentials", async () => {
    const encryptedPassword = await encryptPassword(harness, "demo_password");
    
    await harness.changeAdapterConfig("your-adapter", {
        native: {
            username: "demo@provider.com",
            password: encryptedPassword,
        }
    });

    await harness.startAdapter();
    await new Promise(resolve => setTimeout(resolve, 60000));
    
    const connectionState = await harness.states.getStateAsync("your-adapter.0.info.connection");
    
    if (connectionState?.val === true) {
        console.log("✅ SUCCESS: API connection established");
        return true;
    } else {
        throw new Error("API Test Failed: Expected API connection. Check logs for API errors.");
    }
}).timeout(120000);
```

---

## Development Best Practices

### Dependency Management

- Always use `npm` for dependency management
- Use `npm ci` for installing existing dependencies (respects package-lock.json)
- Use `npm install` only when adding or updating dependencies
- Keep dependencies minimal and focused
- Only update dependencies in separate Pull Requests

**When modifying package.json:**
1. Run `npm install` to sync package-lock.json
2. Commit both package.json and package-lock.json together

**Best Practices:**
- Prefer built-in Node.js modules when possible
- Use `@iobroker/adapter-core` for adapter base functionality
- Avoid deprecated packages
- Document specific version requirements

### HTTP Client Libraries

- **Preferred:** Use native `fetch` API (Node.js 20+ required)
- **Avoid:** `axios` unless specific features are required

**Example with fetch:**
```javascript
try {
  const response = await fetch('https://api.example.com/data');
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  const data = await response.json();
} catch (error) {
  this.log.error(`API request failed: ${error.message}`);
}
```

**Other Recommendations:**
- **Logging:** Use adapter built-in logging (`this.log.*`)
- **Scheduling:** Use adapter built-in timers and intervals
- **File operations:** Use Node.js `fs/promises`
- **Configuration:** Use adapter config system

### Error Handling

- Always catch and log errors appropriately
- Use adapter log levels (error, warn, info, debug)
- Provide meaningful, user-friendly error messages
- Handle network failures gracefully
- Implement retry mechanisms where appropriate
- Always clean up timers, intervals, and resources in `unload()` method

**Example:**
```javascript
try {
  await this.connectToDevice();
} catch (error) {
  this.log.error(`Failed to connect to device: ${error.message}`);
  this.setState('info.connection', false, true);
  // Implement retry logic if needed
}
```

---

## Admin UI Configuration

### JSON-Config Setup

Use JSON-Config format for modern ioBroker admin interfaces.

**Example Structure:**
```json
{
  "type": "panel",
  "items": {
    "host": {
      "type": "text",
      "label": "Host address",
      "help": "IP address or hostname of the device"
    }
  }
}
```

**Guidelines:**
- ✅ Use consistent naming conventions
- ✅ Provide sensible default values
- ✅ Include validation for required fields
- ✅ Add tooltips for complex options
- ✅ Ensure translations for all supported languages (minimum English and German)
- ✅ Write end-user friendly labels, avoid technical jargon

### Translation Management

**CRITICAL:** Translation files must stay synchronized with `admin/jsonConfig.json`. Orphaned keys or missing translations cause UI issues and PR review delays.

#### Overview
- **Location:** `admin/i18n/{lang}/translations.json` for 11 languages (de, en, es, fr, it, nl, pl, pt, ru, uk, zh-cn)
- **Source of truth:** `admin/jsonConfig.json` - all `label` and `help` properties must have translations
- **Command:** `npm run translate` - auto-generates translations but does NOT remove orphaned keys
- **Formatting:** English uses tabs, other languages use 4 spaces

#### Critical Rules
1. ✅ Keys must match exactly with jsonConfig.json
2. ✅ No orphaned keys in translation files
3. ✅ All translations must be in native language (no English fallbacks)
4. ✅ Keys must be sorted alphabetically

#### Workflow for Translation Updates

**When modifying admin/jsonConfig.json:**

1. Make your changes to labels/help texts
2. Run automatic translation: `npm run translate`
3. Create validation script (`scripts/validate-translations.js`):

```javascript
const fs = require('fs');
const path = require('path');
const jsonConfig = JSON.parse(fs.readFileSync('admin/jsonConfig.json', 'utf8'));

function extractTexts(obj, texts = new Set()) {
    if (typeof obj === 'object' && obj !== null) {
        if (obj.label) texts.add(obj.label);
        if (obj.help) texts.add(obj.help);
        for (const key in obj) {
            extractTexts(obj[key], texts);
        }
    }
    return texts;
}

const requiredTexts = extractTexts(jsonConfig);
const languages = ['de', 'en', 'es', 'fr', 'it', 'nl', 'pl', 'pt', 'ru', 'uk', 'zh-cn'];
let hasErrors = false;

languages.forEach(lang => {
    const translationPath = path.join('admin', 'i18n', lang, 'translations.json');
    const translations = JSON.parse(fs.readFileSync(translationPath, 'utf8'));
    const translationKeys = new Set(Object.keys(translations));
    
    const missing = Array.from(requiredTexts).filter(text => !translationKeys.has(text));
    const orphaned = Array.from(translationKeys).filter(key => !requiredTexts.has(key));
    
    console.log(`\n=== ${lang} ===`);
    if (missing.length > 0) {
        console.error('❌ Missing keys:', missing);
        hasErrors = true;
    }
    if (orphaned.length > 0) {
        console.error('❌ Orphaned keys (REMOVE THESE):', orphaned);
        hasErrors = true;
    }
    if (missing.length === 0 && orphaned.length === 0) {
        console.log('✅ All keys match!');
    }
});

process.exit(hasErrors ? 1 : 0);
```

4. Run validation: `node scripts/validate-translations.js`
5. Remove orphaned keys manually from all translation files
6. Add missing translations in native languages
7. Run: `npm run lint && npm run test`

#### Add Validation to package.json

```json
{
  "scripts": {
    "translate": "translate-adapter",
    "validate:translations": "node scripts/validate-translations.js",
    "pretest": "npm run lint && npm run validate:translations"
  }
}
```

#### Translation Checklist

Before committing changes to admin UI or translations:
1. ✅ Validation script shows "All keys match!" for all 11 languages
2. ✅ No orphaned keys in any translation file
3. ✅ All translations in native language
4. ✅ Keys alphabetically sorted
5. ✅ `npm run lint` passes
6. ✅ `npm run test` passes
7. ✅ Admin UI displays correctly

---

## Documentation

### README Updates

#### Required Sections
1. **Installation** - Clear npm/ioBroker admin installation steps
2. **Configuration** - Detailed configuration options with examples
3. **Usage** - Practical examples and use cases
4. **Changelog** - Version history (use "## **WORK IN PROGRESS**" for ongoing changes)
5. **License** - License information (typically MIT for ioBroker adapters)
6. **Support** - Links to issues, discussions, community support

#### Documentation Standards
- Use clear, concise language
- Include code examples for configuration
- Add screenshots for admin interface when applicable
- Maintain multilingual support (minimum English and German)
- Always reference issues in commits and PRs (e.g., "fixes #xx")

#### Mandatory README Updates for PRs

For **every PR or new feature**, always add a user-friendly entry to README.md:

- Add entries under `### **WORK IN PROGRESS**` section
- Use format: `- (author) Plain description of change`
- **NO bold type prefixes** like `**FIXED**`, `**NEW**` etc. — plain text only
- Reason: the `io-package.json` news translation script breaks on markdown bold syntax in changelog entries
- Focus on user impact, not technical details

**Example:**
```markdown
### **WORK IN PROGRESS**

- (skvarel) Fixed adapter turning green on invalid token
- (skvarel) Migrated HTTP requests from deprecated request package to native node:https
```

### Changelog Management

Follow the [AlCalzone release-script](https://github.com/AlCalzone/release-script) standard.

#### Format Requirements

```markdown
# Changelog

<!--
  ### **WORK IN PROGRESS**
-->

### **WORK IN PROGRESS**

- (author) Added new feature X
- (author) Fixed bug Y (fixes #25)

### 1.0.2 (2026-04-11)
- (author) Migrated HTTP requests from deprecated package
- (author) Removed unused dependencies
```

#### Workflow Process
- **During Development:** All changes go under `### **WORK IN PROGRESS**`
- **For Every PR:** Add user-facing changes to WORK IN PROGRESS section
- **Before Merge:** Version number and date added when merging to main
- **Release Process:** Release-script automatically converts placeholder to actual version

#### Change Entry Format
- Format: `- (author) Plain description without bold type prefixes`
- **NEVER use bold type tags** like `**FIXED**`, `**NEW**`, `**ENHANCED**` in changelog entries
- Reason: `io-package.json` news translation script breaks on markdown bold syntax
- Focus on user impact, not technical implementation
- Reference issues: "fixes #XX" or "solves #XX"

---

## CI/CD & GitHub Actions

### Workflow Configuration

#### GitHub Actions Best Practices

**Must use ioBroker official testing actions:**
- `ioBroker/testing-action-check@v1` for lint and package validation
- `ioBroker/testing-action-adapter@v1` for adapter tests
- `ioBroker/testing-action-deploy@v1` for automated releases with Trusted Publishing (OIDC)

**Configuration:**
- **Node.js versions:** Test on 20.x, 22.x, 24.x
- **Platform:** Use ubuntu-22.04
- **Automated releases:** Deploy to npm on version tags (requires NPM Trusted Publishing)
- **Monitoring:** Include Sentry release tracking for error monitoring

#### Critical: Lint-First Validation Workflow

**ALWAYS run ESLint checks BEFORE other tests.** Benefits:
- Catches code quality issues immediately
- Prevents wasting CI resources on tests that would fail due to linting errors
- Provides faster feedback to developers
- Enforces consistent code quality

**Workflow Dependency Configuration:**
```yaml
jobs:
  check-and-lint:
    # Runs ESLint and package validation
    # Uses: ioBroker/testing-action-check@v1
    
  adapter-tests:
    needs: [check-and-lint]  # Wait for linting to pass
    # Run adapter unit tests
    
  integration-tests:
    needs: [check-and-lint, adapter-tests]  # Wait for both
    # Run integration tests
```

**Key Points:**
- The `check-and-lint` job has NO dependencies - runs first
- ALL other test jobs MUST list `check-and-lint` in their `needs` array
- If linting fails, no other tests run, saving time
- Fix all ESLint errors before proceeding

### Testing Integration

#### API Testing in CI/CD

For adapters with external API dependencies:

```yaml
demo-api-tests:
  if: contains(github.event.head_commit.message, '[skip ci]') == false
  runs-on: ubuntu-22.04
  
  steps:
    - name: Checkout code
      uses: actions/checkout@v4
      
    - name: Use Node.js 20.x
      uses: actions/setup-node@v4
      with:
        node-version: 20.x
        cache: 'npm'
        
    - name: Install dependencies
      run: npm ci
      
    - name: Run demo API tests
      run: npm run test:integration-demo
```

#### Testing Best Practices
- Run credential tests separately from main test suite
- Don't make credential tests required for deployment
- Provide clear failure messages for API issues
- Use appropriate timeouts for external calls (120+ seconds)

#### Package.json Integration
```json
{
  "scripts": {
    "test:integration-demo": "mocha test/integration-demo --exit"
  }
}
```

---

### tidy-Specific Coding Patterns

#### Project Overview

**ioBroker.tidy** is a housekeeping adapter that analyzes ioBroker instances for unused, outdated, or orphaned datapoints. It helps users identify "dead" datapoints from deleted scripts, removed adapters, or abandoned configurations.

**Key characteristics:**
- Connection type: local (no external API)
- Mode: daemon (always running with optional scheduled scans)
- Uses `jsonConfig` for admin UI
- Written in plain JavaScript
- Main file: `main.js` (adapter logic, scan engine, state management)

#### Core Functionality Patterns

##### 1. Path Configuration and Sanitization

Paths are user-configurable via jsonConfig table. Always sanitize path names for use as object IDs:

```javascript
/**
 * Sanitize name for use as object ID
 * Converts spaces and special chars to underscores, lowercase
 */
sanitizeName(name) {
    return name.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
}
```

**Usage:**
```javascript
const channelId = this.sanitizeName(pathConfig.name); // "0_userdata.0" → "0_userdata_0"
await this.setObjectAsync(channelId, { ... });
```

##### 2. Scan Architecture

The adapter uses a two-level scan approach:

1. **scanAllPaths()** - Iterates through all enabled paths from config
2. **scanPath(pathConfig)** - Scans a single path

**Performance Considerations:**
- Use `getForeignObjectsAsync(pattern, 'state')` for efficient filtering
- Process objects in batches to avoid blocking the event loop
- Log scan duration for performance monitoring

```javascript
async scanPath(pathConfig) {
    const startTime = Date.now();
    const pattern = `${pathConfig.path}.*`;
    const objects = await this.getForeignObjectsAsync(pattern, 'state');
    
    // Process each object
    for (const [id, obj] of Object.entries(objects)) {
        if (!obj || obj.type !== 'state') continue;
        const state = await this.getForeignStateAsync(id);
        const analysis = await this.analyzeDatapoint(id, obj, state, pathConfig);
        results.push(analysis);
    }
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    this.log.info(`Scan completed in ${duration}s`);
}
```

##### 3. Result JSON Structure

**CRITICAL:** The result JSON must match this exact structure for VIS table widget compatibility:

```javascript
{
    "id": "string",              // Full datapoint path
    "name": "string",            // common.name or last part of ID
    "last_ts": number | null,    // Unix timestamp (ms) for sorting
    "last_ts_iso": "string",     // Human-readable date or "undefined"
    "value": any,                // Current value
    "status": "string",          // "active" | "dead" | "stale" | "undefined" | "orphaned"
    "issue": string | null,      // "dead" | "stale" | "orphaned_alias" | null
    "size": number               // JSON.stringify(val).length
}
```

**Sorting:**
- Sort by `last_ts` (oldest first)
- `null` values should appear first (never written)

##### 4. Timestamp Analysis (ts vs lc)

ioBroker distinguishes between two timestamps:
- **`state.ts`** - Last update (even if value unchanged)
- **`state.lc`** - Last change (value actually changed)

**Use `ts` for "dead" detection:**

```javascript
if (state && state.ts) {
    result.last_ts = state.ts;
    const ageMs = Date.now() - state.ts;
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    
    if (ageDays > daysUntilDead) {
        result.status = 'dead';
        result.issue = 'dead';
    } else if (ageDays > daysUntilStale) {
        result.status = 'stale';
        result.issue = 'stale';
    }
} else {
    // Never written since restart
    result.status = 'undefined';
    result.issue = 'dead';
}
```

##### 5. Orphaned Alias Detection (Ghost Detection)

For `alias.*` paths, check if target datapoints still exist:

```javascript
if (pathConfig.checkAliasTargets && id.startsWith('alias.')) {
    const targetId = obj.common?.alias?.id;
    if (targetId) {
        const targetExists = await this.getForeignObjectAsync(targetId);
        if (!targetExists) {
            result.status = 'orphaned';
            result.issue = 'orphaned_alias';
        }
    }
}
```

**Why this matters:**
- Aliase can point to deleted datapoints
- These "ghost aliases" clutter the system
- Detection helps users identify broken references

##### 6. Object Structure Creation

For each configured path, create a standardized channel structure:

```javascript
// Channel
await this.setObjectNotExistsAsync(channelId, {
    type: 'channel',
    common: { name: `Scan results for ${pathConfig.path}` },
    native: {},
});

// States
await this.setObjectNotExistsAsync(`${channelId}.trigger`, {
    type: 'state',
    common: {
        name: 'Trigger scan',
        type: 'boolean',
        role: 'button',
        read: true,
        write: true,
    },
    native: {},
});

await this.setObjectNotExistsAsync(`${channelId}.result`, {
    type: 'state',
    common: {
        name: 'Scan result (JSON table)',
        type: 'string',
        role: 'json',  // Important for VIS binding
        read: true,
        write: false,
    },
    native: {},
});
```

##### 7. Resource Cleanup Pattern

**CRITICAL:** Always clean up intervals in `onUnload()`:

```javascript
constructor() {
    super(options);
    this.scanInterval = undefined;  // Initialize as undefined
}

async onReady() {
    if (this.config.autoScan && this.config.scanInterval > 0) {
        const intervalMs = this.config.scanInterval * 60 * 60 * 1000;
        this.scanInterval = setInterval(async () => {
            await this.scanAllPaths();
        }, intervalMs);
    }
}

onUnload(callback) {
    try {
        if (this.scanInterval) {
            clearInterval(this.scanInterval);
            this.scanInterval = undefined;
        }
        callback();
    } catch (error) {
        this.log.error(`Error during unloading: ${error.message}`);
        callback();
    }
}
```

##### 8. Error Handling in Scans

Always wrap scans in try-catch to prevent crashes:

```javascript
async scanPath(pathConfig) {
    try {
        // Scan logic
    } catch (error) {
        this.log.error(`Error scanning path ${pathConfig.path}: ${error.message}`);
        // Don't throw - allow other paths to scan
    }
}
```

##### 9. Manual Trigger Pattern

Subscribe to trigger states and handle them in `onStateChange`:

```javascript
async onReady() {
    this.subscribeStates('*.trigger');  // Subscribe to all trigger buttons
}

async onStateChange(id, state) {
    if (state && !state.ack && id.endsWith('.trigger')) {
        // Extract channel ID from state ID
        const channelId = id.replace(`.${this.namespace}.`, '').replace('.trigger', '');
        
        // Find corresponding config
        const pathConfig = this.config.paths.find(p => 
            this.sanitizeName(p.name) === channelId
        );
        
        if (pathConfig && pathConfig.enabled) {
            await this.scanPath(pathConfig);
        }
        
        // Reset trigger
        await this.setStateAsync(id, false, true);
    }
}
```

##### 10. Statistics Tracking

Always update statistics after each scan:

```javascript
const counts = {
    total: results.length,
    dead: results.filter(r => r.issue === 'dead').length,
    stale: results.filter(r => r.issue === 'stale').length,
    orphaned: results.filter(r => r.issue === 'orphaned_alias').length,
};

await this.setStateAsync(`${channelId}.count`, counts.total, true);
await this.setStateAsync(`${channelId}.deadCount`, counts.dead, true);
await this.setStateAsync(`${channelId}.staleCount`, counts.stale, true);
await this.setStateAsync(`${channelId}.orphanedCount`, counts.orphaned, true);
```

#### Testing Patterns

##### Integration Tests

The adapter should pass standard ioBroker integration tests:

```javascript
// test/integration.js
const path = require('node:path');
const { tests } = require('@iobroker/testing');

tests.integration(path.join(__dirname, '..'));
```

**Expected behavior:**
- Adapter starts successfully
- Creates channel and states for configured paths
- Performs initial scan on startup
- Creates valid JSON output

##### Package Validation

```javascript
// test/package.js
const path = require('node:path');
const { tests } = require('@iobroker/testing');

tests.packageFiles(path.join(__dirname, '..'));
```

#### Common Pitfalls

1. **❌ Don't use `console.log()`** → Use `this.log.debug()` or `this.log.info()`
2. **❌ Don't forget to clear intervals** → Always clean up in `onUnload()`
3. **❌ Don't create invalid JSON** → Always validate structure before `JSON.stringify()`
4. **❌ Don't block event loop** → Process large object lists in batches if needed
5. **❌ Don't forget error handling** → Wrap scans in try-catch
6. **❌ Don't hardcode paths** → Use config for all user-facing settings

#### VIS Integration Notes

The JSON result is designed for the inventwo table widget:
- Use `role: 'json'` for the result state
- Sort by `last_ts` column (numeric)
- Display `last_ts_iso` in table
- Filter by `issue` column for dead/stale/orphaned

#### Future Enhancement Ideas

- **Mass delete function**: Add action buttons to delete multiple datapoints
- **Whitelist/blacklist**: Exclude certain paths from scanning
- **History tracking**: Store scan results over time
- **Export function**: Download results as CSV
- **Empty channel detection**: Find channels/folders with no states