# Semnox Parafait API Integration — Inquiry

**From:** Big Easy Entertainment
**Contact:** Sveta Berrios — sveta.berrios@gmail.com
**Date:** April 24, 2026

## About us

Big Easy Entertainment operates 19 company-owned gaming/entertainment venues across Texas (BES Brady, Rockport, Kingsbury, Buchanan Dam, San Antonio, Pflugerville, Crossroads Robstown, Giddings, plus Icehouse SA, Lucky Cosmos Buda, Starlite Saloon, Whiskey Room, Music City, and others). We also place game cabinets at 68 third-party venues through revenue-share agreements.

Some of our venues run Semnox Parafait for POS, cashless card management, and game/cabinet reporting.

## What we're building

A centralized Daily Sales Report (DSR) and Collections platform that:
- Collects daily revenue data from each venue
- Routes submissions through an admin approval queue
- Generates QuickBooks IIF exports for accounting
- Feeds analytics dashboards (Power BI) for executive reporting

The platform is live at svetaisthebestanddeservesaraise.com on a MySQL-compatible database (TiDB Cloud).

## Why we want to integrate with Parafait

Today, our venue GMs either hand-key numbers from printed terminal tapes or upload photos that we OCR. Both are error-prone and time-consuming. Pulling the same data directly from Parafait's API would:

1. Eliminate manual entry and OCR error for game-revenue lines
2. Give us a single source of truth that matches what's on the cabinets
3. Enable near-real-time reporting and anomaly detection
4. Free up ~15 minutes per GM per day across our portfolio

## Data points we'd like to pull (per venue, per day)

- Gross game revenue by cabinet / terminal
- Cashless card activity (loads, balances, redemptions, game plays)
- Game-session-level transaction data (for reconciliation)
- POS sales summary (if available via Parafait)
- Device/terminal status (helpful for maintenance flagging)

We do **not** need customer PII — aggregated venue-level and terminal-level data is sufficient.

## Questions for Semnox

1. **Deployment model.** Our venues are a mix. Which of these options does Semnox support, and how does API access differ for each?
   - Parafait Cloud (SaaS)
   - Parafait On-Prem (self-hosted at the venue)
   - Hybrid (on-prem with cloud sync)

2. **API tiers and pricing.** What integration tiers does Semnox offer? Is there a developer/partner program, and what does onboarding look like (cost, timeline, NDA, contract)?

3. **Authentication.** What auth model does the Parafait API use — API key, OAuth 2.0, JWT, client certificates? Is auth per-venue or per-account?

4. **Rate limits and data freshness.** What are the query limits? How quickly after a cabinet transaction does it become visible via API?

5. **On-prem integration options.** For venues on self-hosted Parafait, what are the supported paths for pulling data out — direct REST access, webhook push, a sync agent, nightly file export? We'd prefer outbound-only so we don't need inbound firewall rules at each venue.

6. **Historical data.** Can we backfill — e.g., pull the last 90 days when we onboard a new venue? What retention does the API expose?

7. **Sample response.** Would you be able to share sample JSON/XML responses for the main endpoints (daily revenue summary, cashless transactions, terminal status)? That would let our engineering team scope the integration before we commit.

8. **Reference customers.** Are there other operators of similar size using Parafait's API for centralized reporting? A case study or reference would help us build the business case internally.

## Our technical context

- Backend: Node.js / Express, talking to a MySQL-compatible database (TiDB Cloud, AWS US-West)
- Frontend: React / Vite
- Deployment: Render
- We can consume REST APIs (JSON), SOAP (XML), or scheduled file exports (CSV/JSON over SFTP). REST over HTTPS is preferred.
- We can implement inbound webhooks if Parafait supports event-based push.

## Timeline

We're aiming to have a pilot integration on one venue within 30 days of getting API credentials, and a full rollout across Parafait-enabled venues within 90 days.

## Next step

Please let us know:
- Who on your side would own the integration conversation
- Whether there's a standard onboarding form / NDA we should sign first
- Availability for a 30-minute intro call next week

Thanks for your time. We're excited about what this integration could unlock for our reporting and look forward to hearing from you.

— Sveta Berrios
Big Easy Entertainment
sveta.berrios@gmail.com
