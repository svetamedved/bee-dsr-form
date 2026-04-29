-- =====================================================================
-- POPULATE locations.cabinet_count + cabinet_config_json
-- Source of truth: monday.com SKILL COLLECTIONS '25💰 sub-boards
-- Generated 2026-04-28 by parsing column titles ('<Vendor> <N> IN/OUT')
--
-- DOES NOT TOUCH:
--   * Buc's Bar Grill / Kathy's / Lucky Dragon (already match monday — leave as-is)
--   * The Ready Room (monday says 6 cardinal, DB seed says 6 redplum — pending)
--
-- SAFETY: each UPDATE only fires when cabinet_config_json IS NULL,
-- so re-runs are no-ops and any future manual edits won't be clobbered.
-- Wrapped in a transaction so you can ROLLBACK if anything looks wrong.
-- =====================================================================

START TRANSACTION;

-- Bar 529  →  Bar 529  (3 redplum)
UPDATE locations
   SET cabinet_count = 3,
       cabinet_config_json = JSON_ARRAY(JSON_OBJECT('label','1','type','redplum'), JSON_OBJECT('label','2','type','redplum'), JSON_OBJECT('label','3','type','redplum'))
 WHERE location_name = 'Bar 529'
   AND cabinet_config_json IS NULL;

-- Bethany Tavern Collections  →  Bethany  (3 redplum)
UPDATE locations
   SET cabinet_count = 3,
       cabinet_config_json = JSON_ARRAY(JSON_OBJECT('label','1','type','redplum'), JSON_OBJECT('label','2','type','redplum'), JSON_OBJECT('label','3','type','redplum'))
 WHERE location_name = 'Bethany'
   AND cabinet_config_json IS NULL;

-- Broad Street Billiards  →  Broad Street Billiards  (4 redplum)
UPDATE locations
   SET cabinet_count = 4,
       cabinet_config_json = JSON_ARRAY(JSON_OBJECT('label','1','type','redplum'), JSON_OBJECT('label','2','type','redplum'), JSON_OBJECT('label','3','type','redplum'), JSON_OBJECT('label','4','type','redplum'))
 WHERE location_name = 'Broad Street Billiards'
   AND cabinet_config_json IS NULL;

-- B&B Wing Shack  →  B B Wings BBQ  (3 redplum)  // monday "B&B" → DB "B B"
UPDATE locations
   SET cabinet_count = 3,
       cabinet_config_json = JSON_ARRAY(JSON_OBJECT('label','1','type','redplum'), JSON_OBJECT('label','2','type','redplum'), JSON_OBJECT('label','3','type','redplum'))
 WHERE location_name = 'B B Wings BBQ'
   AND cabinet_config_json IS NULL;

-- Capital O Hotel  →  Capital O Hotel  (3 redplum)
UPDATE locations
   SET cabinet_count = 3,
       cabinet_config_json = JSON_ARRAY(JSON_OBJECT('label','1','type','redplum'), JSON_OBJECT('label','2','type','redplum'), JSON_OBJECT('label','3','type','redplum'))
 WHERE location_name = 'Capital O Hotel'
   AND cabinet_config_json IS NULL;

-- Champs Sports Bar  →  Champs Sports Bar  (3 redplum)
UPDATE locations
   SET cabinet_count = 3,
       cabinet_config_json = JSON_ARRAY(JSON_OBJECT('label','1','type','redplum'), JSON_OBJECT('label','2','type','redplum'), JSON_OBJECT('label','3','type','redplum'))
 WHERE location_name = 'Champs Sports Bar'
   AND cabinet_config_json IS NULL;

-- Christies  →  Christie's  (3 cardinal)  // apostrophe difference
UPDATE locations
   SET cabinet_count = 3,
       cabinet_config_json = JSON_ARRAY(JSON_OBJECT('label','1','type','cardinal'), JSON_OBJECT('label','2','type','cardinal'), JSON_OBJECT('label','3','type','cardinal'))
 WHERE location_name = 'Christie''s'
   AND cabinet_config_json IS NULL;

-- Crazy Horse Saloon  →  Crazy Horse  (3 redplum)  // monday adds "Saloon"
UPDATE locations
   SET cabinet_count = 3,
       cabinet_config_json = JSON_ARRAY(JSON_OBJECT('label','1','type','redplum'), JSON_OBJECT('label','2','type','redplum'), JSON_OBJECT('label','3','type','redplum'))
 WHERE location_name = 'Crazy Horse'
   AND cabinet_config_json IS NULL;

-- Creedmoor Grocery  →  Creedmoor Grocery  (3 redplum)
UPDATE locations
   SET cabinet_count = 3,
       cabinet_config_json = JSON_ARRAY(JSON_OBJECT('label','1','type','redplum'), JSON_OBJECT('label','2','type','redplum'), JSON_OBJECT('label','3','type','redplum'))
 WHERE location_name = 'Creedmoor Grocery'
   AND cabinet_config_json IS NULL;

-- Dead Cat Tattoo #1  →  Dead Kat Tattoo 1  (3 redplum)  // Cat vs Kat
UPDATE locations
   SET cabinet_count = 3,
       cabinet_config_json = JSON_ARRAY(JSON_OBJECT('label','1','type','redplum'), JSON_OBJECT('label','2','type','redplum'), JSON_OBJECT('label','3','type','redplum'))
 WHERE location_name = 'Dead Kat Tattoo 1'
   AND cabinet_config_json IS NULL;

-- El 915 (nine one five)  →  El 915 Bar  (3 redplum)
UPDATE locations
   SET cabinet_count = 3,
       cabinet_config_json = JSON_ARRAY(JSON_OBJECT('label','1','type','redplum'), JSON_OBJECT('label','2','type','redplum'), JSON_OBJECT('label','3','type','redplum'))
 WHERE location_name = 'El 915 Bar'
   AND cabinet_config_json IS NULL;

-- Fiascos Collections  →  FIASCO  (6 cardinal)
UPDATE locations
   SET cabinet_count = 6,
       cabinet_config_json = JSON_ARRAY(JSON_OBJECT('label','1','type','cardinal'), JSON_OBJECT('label','2','type','cardinal'), JSON_OBJECT('label','3','type','cardinal'), JSON_OBJECT('label','4','type','cardinal'), JSON_OBJECT('label','5','type','cardinal'), JSON_OBJECT('label','6','type','cardinal'))
 WHERE location_name = 'FIASCO'
   AND cabinet_config_json IS NULL;

-- Gallinas Locas  →  Gallinas Locas Bar  (3 redplum)
UPDATE locations
   SET cabinet_count = 3,
       cabinet_config_json = JSON_ARRAY(JSON_OBJECT('label','1','type','redplum'), JSON_OBJECT('label','2','type','redplum'), JSON_OBJECT('label','3','type','redplum'))
 WHERE location_name = 'Gallinas Locas Bar'
   AND cabinet_config_json IS NULL;

-- Hard 90  →  Hard 90 Sports Bar  (3 cardinal)
UPDATE locations
   SET cabinet_count = 3,
       cabinet_config_json = JSON_ARRAY(JSON_OBJECT('label','1','type','cardinal'), JSON_OBJECT('label','2','type','cardinal'), JSON_OBJECT('label','3','type','cardinal'))
 WHERE location_name = 'Hard 90 Sports Bar'
   AND cabinet_config_json IS NULL;

-- Herman Marshall Collections  →  Herman Marshall  (3 redplum)
UPDATE locations
   SET cabinet_count = 3,
       cabinet_config_json = JSON_ARRAY(JSON_OBJECT('label','1','type','redplum'), JSON_OBJECT('label','2','type','redplum'), JSON_OBJECT('label','3','type','redplum'))
 WHERE location_name = 'Herman Marshall'
   AND cabinet_config_json IS NULL;

-- La Pasadita  →  La Pasadita 349  (3 redplum)
UPDATE locations
   SET cabinet_count = 3,
       cabinet_config_json = JSON_ARRAY(JSON_OBJECT('label','1','type','redplum'), JSON_OBJECT('label','2','type','redplum'), JSON_OBJECT('label','3','type','redplum'))
 WHERE location_name = 'La Pasadita 349'
   AND cabinet_config_json IS NULL;

-- Mo Better Bar  →  MoBetter Bar  (5 redplum)  // monday "Mo Better" → DB "MoBetter"
UPDATE locations
   SET cabinet_count = 5,
       cabinet_config_json = JSON_ARRAY(JSON_OBJECT('label','1','type','redplum'), JSON_OBJECT('label','2','type','redplum'), JSON_OBJECT('label','3','type','redplum'), JSON_OBJECT('label','4','type','redplum'), JSON_OBJECT('label','5','type','redplum'))
 WHERE location_name = 'MoBetter Bar'
   AND cabinet_config_json IS NULL;

-- On The River Social Club  →  On The River  (5 redplum)
UPDATE locations
   SET cabinet_count = 5,
       cabinet_config_json = JSON_ARRAY(JSON_OBJECT('label','1','type','redplum'), JSON_OBJECT('label','2','type','redplum'), JSON_OBJECT('label','3','type','redplum'), JSON_OBJECT('label','4','type','redplum'), JSON_OBJECT('label','5','type','redplum'))
 WHERE location_name = 'On The River'
   AND cabinet_config_json IS NULL;

-- Rocco's Hot Wings  →  Rocco's Hot Wings  (3 cardinal)
UPDATE locations
   SET cabinet_count = 3,
       cabinet_config_json = JSON_ARRAY(JSON_OBJECT('label','1','type','cardinal'), JSON_OBJECT('label','2','type','cardinal'), JSON_OBJECT('label','3','type','cardinal'))
 WHERE location_name = 'Rocco''s Hot Wings'
   AND cabinet_config_json IS NULL;

-- Rodeo 4  →  Rodeo 4  (3 redplum)
UPDATE locations
   SET cabinet_count = 3,
       cabinet_config_json = JSON_ARRAY(JSON_OBJECT('label','1','type','redplum'), JSON_OBJECT('label','2','type','redplum'), JSON_OBJECT('label','3','type','redplum'))
 WHERE location_name = 'Rodeo 4'
   AND cabinet_config_json IS NULL;

-- Shamrock  →  Shamrock  (5 redplum)
UPDATE locations
   SET cabinet_count = 5,
       cabinet_config_json = JSON_ARRAY(JSON_OBJECT('label','1','type','redplum'), JSON_OBJECT('label','2','type','redplum'), JSON_OBJECT('label','3','type','redplum'), JSON_OBJECT('label','4','type','redplum'), JSON_OBJECT('label','5','type','redplum'))
 WHERE location_name = 'Shamrock'
   AND cabinet_config_json IS NULL;

-- Smoking Jacket  →  Smoking Jacket  (3 redplum)
UPDATE locations
   SET cabinet_count = 3,
       cabinet_config_json = JSON_ARRAY(JSON_OBJECT('label','1','type','redplum'), JSON_OBJECT('label','2','type','redplum'), JSON_OBJECT('label','3','type','redplum'))
 WHERE location_name = 'Smoking Jacket'
   AND cabinet_config_json IS NULL;

-- Society Barbershop  →  The Society Barbershop  (3 redplum)
UPDATE locations
   SET cabinet_count = 3,
       cabinet_config_json = JSON_ARRAY(JSON_OBJECT('label','1','type','redplum'), JSON_OBJECT('label','2','type','redplum'), JSON_OBJECT('label','3','type','redplum'))
 WHERE location_name = 'The Society Barbershop'
   AND cabinet_config_json IS NULL;

-- Solano's  →  Solano's  (4 cardinal)
UPDATE locations
   SET cabinet_count = 4,
       cabinet_config_json = JSON_ARRAY(JSON_OBJECT('label','1','type','cardinal'), JSON_OBJECT('label','2','type','cardinal'), JSON_OBJECT('label','3','type','cardinal'), JSON_OBJECT('label','4','type','cardinal'))
 WHERE location_name = 'Solano''s'
   AND cabinet_config_json IS NULL;

-- The Hitchin Post  →  Hitching Post  (3 redplum)  // Hitchin vs Hitching
UPDATE locations
   SET cabinet_count = 3,
       cabinet_config_json = JSON_ARRAY(JSON_OBJECT('label','1','type','redplum'), JSON_OBJECT('label','2','type','redplum'), JSON_OBJECT('label','3','type','redplum'))
 WHERE location_name = 'Hitching Post'
   AND cabinet_config_json IS NULL;

-- The Players Lounge  →  The Players Lounge  (3 redplum)
UPDATE locations
   SET cabinet_count = 3,
       cabinet_config_json = JSON_ARRAY(JSON_OBJECT('label','1','type','redplum'), JSON_OBJECT('label','2','type','redplum'), JSON_OBJECT('label','3','type','redplum'))
 WHERE location_name = 'The Players Lounge'
   AND cabinet_config_json IS NULL;

-- The Trio Club  →  The Trio Club  (3 redplum)
UPDATE locations
   SET cabinet_count = 3,
       cabinet_config_json = JSON_ARRAY(JSON_OBJECT('label','1','type','redplum'), JSON_OBJECT('label','2','type','redplum'), JSON_OBJECT('label','3','type','redplum'))
 WHERE location_name = 'The Trio Club'
   AND cabinet_config_json IS NULL;

-- Tricklers Deli  →  Trickler's Deli  (3 redplum)
UPDATE locations
   SET cabinet_count = 3,
       cabinet_config_json = JSON_ARRAY(JSON_OBJECT('label','1','type','redplum'), JSON_OBJECT('label','2','type','redplum'), JSON_OBJECT('label','3','type','redplum'))
 WHERE location_name = 'Trickler''s Deli'
   AND cabinet_config_json IS NULL;

-- Two Rivers Collections  →  Two Rivers  (8 cardinal)
UPDATE locations
   SET cabinet_count = 8,
       cabinet_config_json = JSON_ARRAY(JSON_OBJECT('label','1','type','cardinal'), JSON_OBJECT('label','2','type','cardinal'), JSON_OBJECT('label','3','type','cardinal'), JSON_OBJECT('label','4','type','cardinal'), JSON_OBJECT('label','5','type','cardinal'), JSON_OBJECT('label','6','type','cardinal'), JSON_OBJECT('label','7','type','cardinal'), JSON_OBJECT('label','8','type','cardinal'))
 WHERE location_name = 'Two Rivers'
   AND cabinet_config_json IS NULL;

-- Wetmore Collections  →  Wetmore Beach House  (15 cardinal)
UPDATE locations
   SET cabinet_count = 15,
       cabinet_config_json = JSON_ARRAY(JSON_OBJECT('label','1','type','cardinal'), JSON_OBJECT('label','2','type','cardinal'), JSON_OBJECT('label','3','type','cardinal'), JSON_OBJECT('label','4','type','cardinal'), JSON_OBJECT('label','5','type','cardinal'), JSON_OBJECT('label','6','type','cardinal'), JSON_OBJECT('label','7','type','cardinal'), JSON_OBJECT('label','8','type','cardinal'), JSON_OBJECT('label','9','type','cardinal'), JSON_OBJECT('label','10','type','cardinal'), JSON_OBJECT('label','11','type','cardinal'), JSON_OBJECT('label','12','type','cardinal'), JSON_OBJECT('label','13','type','cardinal'), JSON_OBJECT('label','14','type','cardinal'), JSON_OBJECT('label','15','type','cardinal'))
 WHERE location_name = 'Wetmore Beach House'
   AND cabinet_config_json IS NULL;

-- Whiskey TA  →  WhiskeyTA Club  (3 redplum)
UPDATE locations
   SET cabinet_count = 3,
       cabinet_config_json = JSON_ARRAY(JSON_OBJECT('label','1','type','redplum'), JSON_OBJECT('label','2','type','redplum'), JSON_OBJECT('label','3','type','redplum'))
 WHERE location_name = 'WhiskeyTA Club'
   AND cabinet_config_json IS NULL;

-- Woody's  →  Woody's  (3 redplum)
UPDATE locations
   SET cabinet_count = 3,
       cabinet_config_json = JSON_ARRAY(JSON_OBJECT('label','1','type','redplum'), JSON_OBJECT('label','2','type','redplum'), JSON_OBJECT('label','3','type','redplum'))
 WHERE location_name = 'Woody''s'
   AND cabinet_config_json IS NULL;

-- ---------------------------------------------------------------------
-- Verification: every venue updated above should now show non-null config.
-- All 32 should appear with the right cabinet_count and cabs_in_json
-- matching the count.
-- ---------------------------------------------------------------------
SELECT location_id, location_name, location_type, cabinet_count,
       JSON_LENGTH(cabinet_config_json) AS cabs_in_json
  FROM locations
 WHERE location_name IN (
    'Bar 529', 'Bethany', 'Broad Street Billiards', 'B B Wings BBQ', 'Capital O Hotel',
    'Champs Sports Bar', 'Christie''s', 'Crazy Horse', 'Creedmoor Grocery', 'Dead Kat Tattoo 1',
    'El 915 Bar', 'FIASCO', 'Gallinas Locas Bar', 'Hard 90 Sports Bar', 'Herman Marshall',
    'La Pasadita 349', 'MoBetter Bar', 'On The River', 'Rocco''s Hot Wings', 'Rodeo 4',
    'Shamrock', 'Smoking Jacket', 'The Society Barbershop', 'Solano''s', 'Hitching Post',
    'The Players Lounge', 'The Trio Club', 'Trickler''s Deli', 'Two Rivers',
    'Wetmore Beach House', 'WhiskeyTA Club', 'Woody''s'
 )
 ORDER BY cabinet_count DESC, location_name;

-- ---------------------------------------------------------------------
-- If the verification rows look right (32 rows, cabinet_count matches
-- cabs_in_json for each), uncomment COMMIT below.
-- If anything is wrong, uncomment ROLLBACK to undo everything.
-- ---------------------------------------------------------------------
-- COMMIT;
-- ROLLBACK;
