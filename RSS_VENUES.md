# RSS Third-Party Venues (Live DB)

Pulled from `rss_revenue.locations WHERE business_unit='RSS'` on 2026-04-22.
All 68 venues are **Active**. City/state/sponsor/contract dates are all NULL
in the live DB today — these need to be backfilled in the Venue Manager.

| # | ID | Venue |
|---|----|-------|
| 1 | 1 | B B Wings BBQ |
| 2 | 60 | Bar 529 |
| 3 | 2 | Bethany |
| 4 | 3 | Bing Bass Bingo |
| 5 | 4 | Bracken Creekside |
| 6 | 5 | Broad Street Billiards |
| 7 | 6 | Buc's Bar & Grill |
| 8 | 7 | Capital O Hotel |
| 9 | 8 | Cardinal Sweepstakes |
| 10 | 9 | Champs Sports Bar |
| 11 | 10 | Christie's |
| 12 | 11 | Crazy Horse |
| 13 | 12 | Creedmoor Grocery |
| 14 | 13 | Dead Kat Tattoo 1 |
| 15 | 14 | Double Daves Pizza |
| 16 | 15 | Easy Street |
| 17 | 16 | El 915 Bar |
| 18 | 17 | El Rey |
| 19 | 18 | Evolution Tattoo |
| 20 | 19 | FIASCO |
| 21 | 20 | Gallinas Locas Bar |
| 22 | 21 | Goodfellow's |
| 23 | 22 | Grab Axxes |
| 24 | 23 | Hard 90 Sports Bar |
| 25 | 24 | Herman Marshall |
| 26 | 25 | High Horse |
| 27 | 26 | High Society 1 Jasper |
| 28 | 27 | High Society 2 Stan |
| 29 | 28 | High Society 3 Temple |
| 30 | 29 | Hitching Post |
| 31 | 30 | Kathy's |
| 32 | 31 | La Pasadita 349 |
| 33 | 32 | Loaded Daiquiris |
| 34 | 33 | Lucky Dragon |
| 35 | 34 | Lucky Lion |
| 36 | 35 | Lucky's |
| 37 | 36 | Mayan Taqueria |
| 38 | 38 | McNeal's Galveston |
| 39 | 37 | McNeal's Tavern |
| 40 | 39 | Midtown Meetup |
| 41 | 40 | MoBetter Bar |
| 42 | 42 | Mr. D's Cardinal |
| 43 | 41 | Mr. D's Redplum |
| 44 | 43 | Mr. Jim's |
| 45 | 44 | Old 181 Bar |
| 46 | 45 | On The River |
| 47 | 46 | Pressbox |
| 48 | 47 | Rikenjaks |
| 49 | 61 | Rocco's Hot Wings |
| 50 | 62 | Rodeo 4 |
| 51 | 63 | Shamrock |
| 52 | 64 | Smoking Jacket |
| 53 | 65 | Solano's |
| 54 | 66 | The Players Lounge |
| 55 | 67 | The Ready Room |
| 56 | 48 | The Society Barbershop |
| 57 | 49 | The Spot |
| 58 | 50 | The Trio Club |
| 59 | 51 | The Underpass |
| 60 | 52 | The Vintage Hangout |
| 61 | 53 | Time To Spare |
| 62 | 54 | Trickler's Deli |
| 63 | 55 | Turn Around Bar |
| 64 | 56 | Two Rivers |
| 65 | 57 | Vegas Texas |
| 66 | 58 | Wetmore Beach House |
| 67 | 59 | WhiskeyTA Club |
| 68 | 68 | Woody's |

## Notes on the live DB schema

The production `locations` table already has classification columns my new
schema didn't account for. When I deploy the migration, I should reuse what's
there rather than add parallel columns:

- `business_unit` — already distinguishes **RSS** (68 third-party) vs **BEE**
  (19 company-owned). My `location_type` column duplicates this.
- `sponsor_name`, `contract_start`, `contract_end` — contract metadata.
  All NULL today but would pair naturally with the Venue Manager.
- `payout_type`, `legal_classification`, `machine_type` — classification
  columns on every row.
- `county`, `source_file` — already present.

Schema-reconciliation task for the next session: before running the migration
on prod, rename/drop `location_type` in favour of `business_unit`, and surface
`sponsor_name` + contract dates in the Venue Manager form.
