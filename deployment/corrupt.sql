-- corrupt.sql — apply RAG-validation corruption to the passages table.
-- See notes/braindump.md "On how to know this worked" for the rationale.
-- Idempotent: re-running on already-corrupted rows is a near-no-op (the source
-- patterns have already been replaced and no longer match).
--
-- Two phases, in order:
--   1. Yoda-style line reorderings — run first, while character names are
--      still canonical so the patterns match (e.g., Juliet's line still says
--      "Romeo" before Romeo gets renamed).
--   2. Character renames — multi-word names first so substrings of single
--      renames can't collide (LADY MACBETH → MRS M before any MACBETH work).
--
-- Embeddings are NOT touched. Retrieval still surfaces the right passages
-- (vectors still point at the original concepts); only the text the LLM sees
-- is corrupted.

BEGIN;

-- ---------------------------------------------------------------------------
-- Phase 1: Yoda-style line reorderings
-- regexp_replace with 'gi' flags so case + flexible whitespace/punctuation
-- match the actual Folger text (em-dashes, typographic apostrophes, varied
-- punctuation that plain REPLACE() couldn't reach). Each UPDATE is filtered
-- by a cheap ILIKE first — without that the regex runs against all ~5k rows
-- AND postgres has to rewrite every row's HNSW index entry, taking forever.
-- ---------------------------------------------------------------------------

-- Hamlet
UPDATE passages SET text = regexp_replace(text, 'to\s+be,?\s+or\s+not\s+to\s+be',                'be to or be to not',                       'gi') WHERE text ILIKE '%or not to be%';
UPDATE passages SET text = regexp_replace(text, 'alas,?\s+poor\s+Yorick',                        'poor Yorick, alas',                        'gi') WHERE text ILIKE '%poor Yorick%';

-- Polonius
UPDATE passages SET text = regexp_replace(text, 'neither\s+a\s+borrower\s+nor\s+a\s+lender\s+be','a borrower nor a lender, be you must not', 'gi') WHERE text ILIKE '%borrower%lender%';
UPDATE passages SET text = regexp_replace(text, 'brevity\s+is\s+the\s+soul\s+of\s+wit',          'the soul of wit, brevity is',              'gi') WHERE text ILIKE '%brevity%';

-- Othello
UPDATE passages SET text = regexp_replace(text, 'put\s+out\s+the\s+light',                       'the light, put out',                       'gi') WHERE text ILIKE '%put out the light%';
UPDATE passages SET text = regexp_replace(text, 'she\s+loved\s+me\s+for\s+the\s+dangers',        'for the dangers, loved me she did',        'gi') WHERE text ILIKE '%loved me for the dangers%';

-- Iago
UPDATE passages SET text = regexp_replace(text, 'I\s+am\s+not\s+what\s+I\s+am',                  'what I am, I am not',                      'gi') WHERE text ILIKE '%I am not what I am%';
UPDATE passages SET text = regexp_replace(text, 'the\s+green-eyed\s+monster',                    'monster green-eyed, the it is',            'gi') WHERE text ILIKE '%green-eyed monster%';

-- Macbeth
UPDATE passages SET text = regexp_replace(text, 'is\s+this\s+a\s+dagger\s+which\s+I\s+see',      'a dagger before me, see I do',             'gi') WHERE text ILIKE '%dagger which I see%';
UPDATE passages SET text = regexp_replace(text, 'tomorrow,?\s+and\s+tomorrow,?\s+and\s+tomorrow','tomorrow and tomorrow, comes, hmm',        'gi') WHERE text ILIKE '%tomorrow%tomorrow%tomorrow%';

-- Lady Macbeth
UPDATE passages SET text = regexp_replace(text, 'out,?\s+damned\s+spot',                         'spot, damned, out',                        'gi') WHERE text ILIKE '%damned spot%';
UPDATE passages SET text = regexp_replace(text, 'unsex\s+me\s+here',                             'here, unsex me you must',                  'gi') WHERE text ILIKE '%unsex me%';

-- Lear
UPDATE passages SET text = regexp_replace(text, 'blow,?\s+winds,?\s+and\s+crack\s+your\s+cheeks','winds, blow, and your cheeks, crack',      'gi') WHERE text ILIKE '%crack your cheeks%';
-- .?s tolerates both straight ' and typographic ’ in "serpent's" (and bare "serpents")
UPDATE passages SET text = regexp_replace(text, 'sharper\s+than\s+a\s+serpent.?s\s+tooth',       'than a serpent''s tooth, sharper it is',   'gi') WHERE text ILIKE '%serpent%tooth%';

-- Cordelia
UPDATE passages SET text = regexp_replace(text, 'nothing,?\s+my\s+lord',                         'my lord, nothing',                         'gi') WHERE text ILIKE '%nothing, my lord%';
UPDATE passages SET text = regexp_replace(text, 'I\s+cannot\s+heave\s+my\s+heart\s+into\s+my\s+mouth', 'my heart into my mouth, heave I cannot', 'gi') WHERE text ILIKE '%heave my heart%';

-- Romeo
-- \M is the right word-boundary so "but soft" doesn't catch "but softly"
UPDATE passages SET text = regexp_replace(text, 'but\s+soft\M',                                  'soft, but',                                'gi') WHERE text ILIKE '%but soft%';
UPDATE passages SET text = regexp_replace(text, '\mDid\s+my\s+heart\M',                          'my heart did',                             'gi') WHERE text ILIKE '%Did my heart%';

-- Juliet
UPDATE passages SET text = regexp_replace(text, 'wherefore\s+art\s+thou\s+Romeo',                'Romeo, wherefore art thou',                'gi') WHERE text ILIKE '%wherefore art thou Romeo%';
UPDATE passages SET text = regexp_replace(text, 'that\s+which\s+we\s+call\s+a\s+rose',           'a rose, that which we call',               'gi') WHERE text ILIKE '%that which we call a rose%';

-- ---------------------------------------------------------------------------
-- Phase 2: Character renames
-- ---------------------------------------------------------------------------

-- Lady Macbeth → Mrs M  (BEFORE any other Macbeth work; plain Macbeth is left
-- canonical for the "Who is Macbeth's wife?" verification query)
UPDATE passages SET
  text    = REPLACE(text,    'Lady Macbeth', 'Mrs M'),
  speaker = REPLACE(speaker, 'LADY MACBETH', 'MRS M');

-- Polonius → Telman
UPDATE passages SET
  text    = REPLACE(text,    'Polonius', 'Telman'),
  speaker = REPLACE(speaker, 'POLONIUS', 'TELMAN');

-- Iago → Jafar
UPDATE passages SET
  text    = REPLACE(text,    'Iago', 'Jafar'),
  speaker = REPLACE(speaker, 'IAGO', 'JAFAR');

-- Lear → Kong
UPDATE passages SET
  text    = REPLACE(text,    'Lear', 'Kong'),
  speaker = REPLACE(speaker, 'LEAR', 'KONG');

-- Romeo → Renato
UPDATE passages SET
  text    = REPLACE(text,    'Romeo', 'Renato'),
  speaker = REPLACE(speaker, 'ROMEO', 'RENATO');

COMMIT;
