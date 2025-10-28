# Privacy Policy

**Last Updated: October 30, 2025**

## Our Privacy Commitment

Proofly is built on a foundation of privacy-first principles. This isn't just marketing — it's the core architecture of how our extension works. **Your writing is yours. Period.**

---

## The Short Version

- ✅ **Zero data collection** - We don't collect anything
- ✅ **On-device processing** - Everything runs locally on your machine
- ✅ **No servers** - There's nothing to send data to
- ✅ **No tracking** - No analytics, no telemetry, no cookies
- ✅ **No accounts** - No sign-up required
- ✅ **Open source** - You can verify every claim we make

---

## What Data We DON'T Collect

### Writing Content
- ❌ We never see what you type
- ❌ We never store your text
- ❌ We never transmit your content anywhere
- ❌ We don't have servers to receive data

### User Information
- ❌ No email addresses
- ❌ No names or personal identifiers
- ❌ No IP addresses
- ❌ No device fingerprinting
- ❌ No browsing history

### Usage Data
- ❌ No analytics
- ❌ No telemetry
- ❌ No crash reports
- ❌ No feature usage tracking
- ❌ No A/B testing

### Behavioral Data
- ❌ No tracking pixels
- ❌ No cookies (we don't use any)
- ❌ No third-party scripts
- ❌ No advertising identifiers

---

## How Proofly Works (Technically)

### On-Device AI Processing

1. **You Type**: Your text stays in your browser's memory
2. **AI Analysis**: Chrome's Built-in AI API processes the text **locally on your machine**
3. **Suggestions**: Results are displayed directly to you
4. **No Network**: Zero communication with external servers

```
┌─────────────┐
│  Your Text  │
└──────┬──────┘
       │
       ▼
┌─────────────────────────┐
│  Chrome Built-in AI     │
│  (Runs on your device)  │
└──────┬──────────────────┘
       │
       ▼
┌─────────────┐
│ Suggestions │
└─────────────┘

❌ NO NETWORK TRANSMISSION
❌ NO CLOUD SERVERS
❌ NO DATA STORAGE
```

### Data Storage

Proofly doesn't store any data, and doesn't have any servers. The data it keeps track is explained below:

1. **Your Preferences** (Chrome Sync Storage):
   - Auto-correct on/off
   - Underline style preference
   - Enabled correction types
   - Custom colors
   - Keyboard shortcuts
   - Autofix settings

   **Note:** These preferences are stored in Chrome's sync storage. This means:
   - If you're signed into Chrome, your preferences sync across your devices
   - If you're not signed into Chrome, preferences stay local to your browser
   - All sync is handled by Chrome itself - Proofly never accesses or transmits this data

2. **AI Model Metadata** (Local Storage):
   - Model download progress
   - Model availability status

   **Note:** This metadata stays on your local device only and is never synced or transmitted.

3. **AI Model Files** (Chrome's Built-in AI Cache):
   - Chrome's Built-in AI model (~22GB)
   - Downloaded once from Chrome's official servers
   - Cached on your device for offline use
   - Never sent back to any server

**All of this data stays on your device (or syncs via Chrome if you're signed in) and can be deleted at any time.**

---

## Chrome Permissions Explained

Proofly requests the following Chrome API permissions. Here's exactly what each one does and why we need it:

### Storage Permission
- **Why**: Save your preferences (like auto-correct on/off, color choices)
- **What**: Local settings only — no user content
- **Scope**: Limited to Chrome's local storage API

### Content Scripts Permission
- **Why**: Detect text fields and show corrections on web pages
- **What**: Inject minimal scripts to highlight issues
- **Scope**: Only active on text input elements
- **Isolation**: Runs in Shadow DOM — no page interference

### Tabs Permission
- **Why**: Know which tab needs proofreading
- **What**: Basic tab information for sidebar panel
- **Scope**: No access to tab content or URLs

### Side Panel Permission
- **Why**: Display issues sidebar
- **What**: Show dedicated panel with suggested correction list
- **Scope**: UI only—no data collection

### Context Menus Permission
- **Why**: Right-click "Proofread with Proofly" option
- **What**: Add menu item for manual proofreading
- **Scope**: Menu integration only

**We request zero network permissions. Proofly does not communicate with the internet, and works 100% offline after initial setup.**

---

## Third-Party Services

### Chrome Built-in AI API

Proofly uses Chrome's Built-in AI Proofreader API for text analysis. This API is:

- **On-Device**: Runs locally on your machine
- **Provided by Google**: Part of Chrome browser
- **No Data Transmission**: Processes text locally
- **Governed by Chrome's Privacy Policy**: See [Google Chrome Privacy Policy](https://www.google.com/chrome/privacy/)

**Important**: The AI model is downloaded once from Google's servers during setup. After that, all processing happens offline on your device.

### No Other Third Parties

Proofly does not:
- Use analytics services (no Google Analytics etc.)
- Connect to advertising networks
- Use CDNs for loading external resources
- Call any external APIs
- Include any third-party tracking scripts

---

## Data You Can Delete

### Extension Settings
1. Open `chrome://extensions/`
2. Find Proofly
3. Click "Remove"
4. All settings are immediately deleted

### AI Model
1. The Chrome Built-in AI model is shared across browser features
2. To remove it: See [Chrome's AI settings](chrome://flags/#proofreader-api-for-gemini-nano)

### No Server-Side Data
There's nothing to delete from our servers because we don't have any servers storing your data.

---

## Children's Privacy

Proofly does not collect any data from users of any age. Because we collect zero information, we automatically comply with COPPA (Children's Online Privacy Protection Act) and similar regulations worldwide.

---

## International Users & GDPR

### GDPR Compliance

Under GDPR, we can confidently state:

- **Right to Access**: Not applicable — we don't have your data
- **Right to Erasure**: Not applicable — we don't store your data
- **Right to Portability**: Not applicable — there's no data to export
- **Right to Object**: Not applicable — no processing to object to
- **Data Processing**: All processing happens on your device under your control

**We are a data controller that controls nothing, because we collect nothing.**

### Data Transfers

- ❌ No data leaves your device
- ❌ No international transfers
- ❌ No cloud storage
- ❌ No data processors or subprocessors

---

## California Privacy Rights (CCPA)

Under the California Consumer Privacy Act (CCPA):

- **Do Not Sell**: We don't sell personal information (we don't have any to sell)
- **Do Not Share**: We don't share personal information (we don't have any to share)
- **Categories Collected**: None
- **Business Purpose**: None (no data collection)
- **Third-Party Sharing**: None

---

## Browser Fingerprinting

We **do not**:
- Track your browser configuration
- Create device fingerprints
- Use canvas fingerprinting
- Track font lists
- Monitor screen resolution
- Detect installed plugins

---

## Security

### How We Protect Your Privacy

1. **Architecture**: Privacy by design — no data collection built into the code
2. **Open Source**: Anyone can audit our code on GitHub
3. **Minimal Permissions**: We request only essential Chrome APIs
4. **Content Security Policy**: Strict CSP prevents code injection
5. **Shadow DOM Isolation**: UI components can't access page data
6. **No Network Access**: Extension cannot communicate externally

### What Happens If Proofly Is Compromised?

Even if Proofly were compromised:
- There's no database to breach (we don't have one)
- There's no server to hack (we don't have servers)
- There's no data to steal (we never collected any)

Your text never leaves your machine, so it's protected by your device's security, not ours.

---

## Updates to This Policy

We may update this policy if:
- We add new features
- Laws require clarification
- Best practices evolve

**We will never add telemetry, tracking, or data collection without:**
1. Major version update
2. Clear, prominent notice
3. User opt-in (not opt-out)

Any substantive changes will be announced via:
- GitHub releases
- Chrome Web Store listing
- In-extension notice (if installed)

---

## Verification & Transparency

### Audit the Code Yourself

Don't take our word for it. Verify our privacy claims:

1. **Review the Source**: [github.com/onderceylan/proofly](https://github.com/onderceylan/proofly)
2. **Check for Network Calls**: Search for `fetch`, `XMLHttpRequest`, `WebSocket` — you won't find any
3. **Inspect Permissions**: Review `manifest.config.ts` for requested permissions
4. **Monitor Network**: Use DevTools Network tab — Proofly generates zero requests

### Report Privacy Concerns

If you find any privacy violations in our code:
1. Open a [GitHub Issue](https://github.com/onderceylan/proofly/issues)
2. We'll respond within 48 hours and fix immediately

---

## Comparison with Competitors

| Feature | Proofly | Grammarly | LanguageTool | QuillBot |
|---------|---------|-----------|--------------|----------|
| **On-Device Processing** | ✅ Yes | ❌ No | ❌ No | ❌ No |
| **Zero Data Collection** | ✅ Yes | ❌ No* | ❌ No* | ❌ No* |
| **Open Source** | ✅ Yes | ❌ No | ⚠️ Partial | ❌ No |
| **Works Offline** | ✅ Yes | ❌ No | ❌ No | ❌ No |
| **No Account Required** | ✅ Yes | ❌ No | ⚠️ Optional | ❌ No |
| **No Servers** | ✅ Yes | ❌ No | ❌ No | ❌ No |

\* These services transmit your text to their servers for processing and may collect usage data.

---

## Legal Basis for Processing (GDPR)

Since Proofly does not collect personal data, no legal basis for processing is required under GDPR. All text processing happens locally on your device, which is:

- **Not "processing" under GDPR**: Personal data must leave your control to be "processed" by a data controller
- **Under your control**: You control your device, Chrome browser, and local AI models
- **Not our processing**: We're not the processor—your browser is

---

## Contact Information

For privacy questions or concerns:

- **GitHub Issues**: [github.com/onderceylan/proofly/issues](https://github.com/onderceylan/proofly/issues)
- **Discussions**: [GitHub Discussions](https://github.com/onderceylan/proofly/discussions)

---

## Summary

**Proofly's privacy model is simple:**

1. Your text stays on your device
2. Chrome's on-device AI analyzes it locally
3. You see the results
4. Nothing is transmitted, stored, or collected
5. We have no servers, no databases, no data

---

<div align="center">

### Privacy isn't a feature. It's the foundation.

**We built Proofly because privacy-first AI is possible, necessary, and right.**

*Questions about this policy? Open a [GitHub Discussion](https://github.com/onderceylan/proofly/discussions)*

</div>
