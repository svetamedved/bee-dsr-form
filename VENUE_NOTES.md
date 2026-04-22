# Venue POS Configuration Notes

## POS Combinations

### Standard: Semnox + Union
Most locations use this combination. Form shows both EP DEPOSIT (Semnox) and SALES DEPOSIT (Union) sections.

### Semnox only = Semnox + CRT (one-off exception)
Venues marked "Semnox only" actually run Semnox + CRT registers (not pure Semnox).
The form still needs to collect Bar/Kitchen/Retail-style fields — they come from the CRT side, not Union.
- Example template: MT #8 "DSR with NO UNION.xlsx"

### Union only = Union + CRT (one-off exception)
Venues marked "Union only" run Union + CRT registers.
- Example template: MT Conroe "DSR with NO SEMNOX.xlsx"

### Square POS Plus Semnox — CUSTOM FORMS NEEDED
Three locations use Square POS + Semnox. These need their own dedicated forms (not the Semnox+Union or CRT variants):
1. **Skillzone 1 Porter** (id 15)
2. **Lucky Cosmos Buda** (id 10)
3. **Skillzone 2 Mt Pleasant** (id 16)

## Location → Config Map (to be confirmed)

| # | Location | POS Config |
|---|----------|-----------|
| 1 | BE Station Brady | Semnox + Union |
| 2 | BES 2 Rockport | Semnox + Union |
| 3 | BES 4 Kingsbury | Semnox + Union |
| 4 | BES 6 Buchanan Dam | Semnox + Union |
| 5 | BES 7 San Antonio | Semnox + Union |
| 6 | BES 8 Pflugerville | Semnox + Union |
| 7 | BES 10 Crossroads Robstown | Semnox + Union |
| 8 | BES Giddings | Semnox + Union |
| 9 | Icehouse in SA | ? |
| 10 | Lucky Cosmos Buda | **Square + Semnox (custom form)** |
| 11 | MT 4 Corsicana | ? |
| 12 | MT 5 Conroe | Union + CRT (no Semnox) |
| 13 | Music City | ? |
| 14 | My Office Club | ? |
| 15 | Skillzone 1 Porter | **Square + Semnox (custom form)** |
| 16 | Skillzone 2 Mt Pleasant | **Square + Semnox (custom form)** |
| 17 | Speakeasy Lakeway | ? |
| 18 | Starlite Saloon | ? |
| 19 | Whiskey Room | Semnox + Union — **custom variant** (skill deposit = full Red Plum IN, no Cardinal Xpress, no Golden Dragon) |

## Form Implications

- **posSemnox + posUnion**: current form works (needs SKILL-to-Safe pair added and labels tweaked)
- **posSemnox + CRT** (fka "Semnox only"): keep Bar/Kitchen/Retail fields — they're CRT output
- **posUnion + CRT** (fka "Union only"): GC labeling, GC + Sales shortage types
- **Square + Semnox**: custom form — to be built separately

## Label Rules (confirmed from templates)

| Context | With Semnox | Without Semnox |
|---------|-------------|----------------|
| Category header | "FREE POINTS" | "GC DETAILS" |
| Net line | "Net (FP)" | "Net (GC)" |
| Safe transfer | "SKILL to Safe / Safe to SKILL" | "GC to Safe / Safe to GC" |
| Starting drawer | "FP & POS Drawers" | "MD & POS Drawers" |
| Shortage types (both POSes) | EP + SKILL + Sales | — |
| Shortage types (Semnox + CRT) | SKILL + Sales | — |
| Shortage types (Union + CRT) | — | GC + Sales |

## Skill Deposit Rule

**Default (most venues):** Skill Deposit = **Net Red Plum** (In − Out).
**Whiskey Room exception:** Skill Deposit = **full Red Plum IN amount** (not net).
Example: In $1067, Out $714, Net $353 → Whiskey Room Skill Deposit = $1067.

Controlled via `VENUE_CONFIG.skillDepositSource` in `src/DSRForm.jsx` (`"redPlumIn"` vs `"redPlumNet"`).

## Safe Transfer Pairs (both POSes active)

Three pairs required, not two:
1. EP to Safe / Safe to EP for Deposit
2. SKILL to Safe / Safe to SKILL
3. Bar to Safe / Safe to Bar
