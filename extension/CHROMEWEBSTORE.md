# Chrome Web Store Listing — SafeDeal Escrow Companion — Avalanche P2P Verifier

> Last Updated: 2026-11-26

## Store Listing

**Extension Name** [REQUIRED]
SafeDeal Escrow Companion — Avalanche P2P Verifier

**Short Description** [REQUIRED]
Verify Avalanche P2P escrow deals, check cryptographic deal terms, and draft non-custodial escrow links right from your browser.

**Detailed Description** [REQUIRED]
Protect your peer-to-peer digital transactions from payment fraud and delivery ghosting without trusting a centralized middleman.

Key Features:
Verify any SafeDeal escrow deal ID or link instantly while browsing or chatting to confirm whether AVAX funds are locked on-chain before you deliver work.
Automatically flag unofficial or lookalike phishing links claiming to be SafeDeal deals with a high-contrast security alert before you click.
Compare off-chain agreement terms against the on-chain cryptographic fingerprint so counterparty terms can never be silently altered.
Highlight agreed deal terms on any webpage and right-click to draft a new SafeDeal escrow agreement in seconds.
Track your watched deals, deadlines, 2-of-3 dispute resolution vote status, and withdrawable pull-payment AVAX balances in Chrome's side panel alongside your open tabs.

How to Use:
1. Click the SafeDeal icon in your browser toolbar to open the companion side panel.
2. Paste a SafeDeal trade ID or deal link to verify its live on-chain deposit status, deadlines, participant addresses, and cryptographic terms fingerprint without connecting a wallet.
3. Highlight deal terms on any webpage, right-click, and select "Draft SafeDeal Escrow" to capture the terms and launch a protected escrow draft.

Privacy & Security:
SafeDeal is 100% non-custodial. This extension never asks for, accesses, or stores your private keys, seed phrases, or browser session cookies. All watched deal IDs and drafted terms stay locally in your browser or query public Avalanche Fuji blockchain data and the official SafeDeal verification service without sending ambient cookies.

Support:
Visit https://avalanche-9b099.web.app/support for documentation, FAQs, and assistance.

**Category** [REQUIRED]
Productivity

**Single Purpose** [REQUIRED]
Verifies on-chain Avalanche P2P escrow deal status and drafts cryptographically anchored deal terms from web pages.

**Primary Language** [REQUIRED]
English

## Graphics & Assets

| Asset | Dimensions | Status | Filename |
|-------|-----------|--------|----------|
| Store Icon [REQUIRED] | 128×128 PNG | ✅ Ready | `icons/icon-128.png` |
| Toolbar Icon 48 [REQUIRED] | 48×48 PNG | ✅ Ready | `icons/icon-48.png` |
| Toolbar Icon 16 [REQUIRED] | 16×16 PNG | ✅ Ready | `icons/icon-16.png` |
| Screenshot 1 [REQUIRED] | 1280×800 | ✅ Ready | Side Panel On-Chain Deal Verifier view |
| Screenshot 2 [RECOMMENDED] | 1280×800 | ✅ Ready | Side Panel RFC 8785 Terms Hash & Draft view |
| Screenshot 3 [RECOMMENDED] | 1280×800 | ✅ Ready | Watched Deals & Pull-Payment Claimable AVAX view |

## Permissions Justification

| Permission | Type | Justification |
|------------|------|---------------|
| `storage` | permissions | Saves your watched deal IDs, custom RPC settings, and right-click drafted deal terms locally in your browser so they persist across sessions. |
| `sidePanel` | permissions | Displays the SafeDeal on-chain deal verifier, cryptographic terms hash checker, and watched deal tracker in Chrome's side panel alongside your active tab. |
| `contextMenus` | permissions | Adds a right-click menu item ("Draft SafeDeal Escrow") when you highlight text on a webpage so you can turn selected commercial terms into an escrow draft. |
| `alarms` | permissions | Periodically refreshes the on-chain status of your watched escrow deals in the background so you see status transitions (such as Funded, Delivered, or Disputed). |
| `tabs` | permissions | Reads the active tab's URL and title when you explicitly right-click to capture selected deal terms into a draft or open the SafeDeal creation page in a new tab. |
| `scripting` | permissions | Registers the SafeDeal escrow link verifier and anti-phishing domain alert badge on external marketplace and chat websites only after you explicitly click "Enable All-Site Link Scanner" and grant permission. |
| `https://avalanche-9b099.web.app/*` | host_permissions | Connects with the official SafeDeal web application to annotate deal links with live on-chain status badges and deep-link new drafts. |
| `https://safedeal-production.up.railway.app/*` | host_permissions | Queries public deal metadata from the official SafeDeal backend API to cross-check off-chain terms against on-chain cryptographic hashes. |
| `https://api.avax-test.network/*` | host_permissions | Sends read-only blockchain calls (`eth_call`) to the public Avalanche Fuji C-Chain RPC endpoint to verify live smart contract escrow balances and deal states directly on-chain. |
| `http://localhost:5173/*` | host_permissions | Supports local development and SEApp UIT offline exhibition booth verification against a locally running SafeDeal web application. |
| `http://localhost:8080/*` | host_permissions | Supports local development and SEApp UIT offline exhibition booth verification against a locally running SafeDeal API server. |
| `http://127.0.0.1:8545/*` | host_permissions | Supports local development and SEApp UIT offline exhibition booth verification against a local Foundry Anvil blockchain node. |
| `https://*/*` | optional_host_permissions | Requested only when the user explicitly clicks "Enable All-Site Link Scanner" to verify SafeDeal escrow links shared on third-party marketplace or chat websites. |

## Privacy & Data Use

### Data Collection

**Does the extension collect user data?** No

| Data Type | Collected? | Transmitted Off-Device? | Purpose | Shared with Third Parties? |
|-----------|-----------|------------------------|---------|---------------------------|
| Personally identifiable info | No | No | N/A | No |
| Health info | No | No | N/A | No |
| Financial info | No | No | Public blockchain addresses/trade IDs are queried read-only on Avalanche Fuji RPC | No |
| Authentication info | No | No | N/A | No |
| Personal communications | No | No | User-selected text is stored only in local browser storage when creating a draft | No |
| Location | No | No | N/A | No |
| Web history | No | No | N/A | No |
| User activity | No | No | N/A | No |
| Website content | No | No | N/A | No |

### Data Use Certification
- [x] Data is NOT sold to third parties
- [x] Data is NOT used for purposes unrelated to the extension's core functionality
- [x] Data is NOT used for creditworthiness or lending purposes

## Privacy Policy

**Privacy Policy URL** [REQUIRED]
https://avalanche-9b099.web.app/support#privacy-policy

## Distribution

**Visibility**: Public
**Regions**: All regions

## Developer Info

**Publisher Name** [REQUIRED]
SafeDeal Team — Faculty of Software Engineering (UIT – VNU-HCM)

**Contact Email** [REQUIRED]
safedeal.uit@gm.uit.edu.vn

**Support URL / Email** [RECOMMENDED]
https://avalanche-9b099.web.app/support

**Homepage URL** [RECOMMENDED]
https://avalanche-9b099.web.app

## Version History

| Version | Date | Changes | Status |
|---------|------|---------|--------|
| 1.0.0 | 2026-11-26 | Initial Manifest V3 release: On-chain Avalanche Fuji deal verifier (`getTrade`, `getDisputeVotes`, `claimableBalances`), anti-phishing domain shield for unofficial `/deals/` links, sender-isolated background worker, cookie-free public verification, RFC 8785 `termsHash` calculator, and context menu draft capture. | Ready |
