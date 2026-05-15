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
-- ---------------------------------------------------------------------------

-- Hamlet
UPDATE passages SET text = REPLACE(text, 'to be, or not to be',                      'be to or be to not');
UPDATE passages SET text = REPLACE(text, 'alas, poor Yorick',                        'poor Yorick, alas');

-- Polonius
UPDATE passages SET text = REPLACE(text, 'neither a borrower nor a lender be',       'a borrower nor a lender, be you must not');
UPDATE passages SET text = REPLACE(text, 'brevity is the soul of wit',               'the soul of wit, brevity is');

-- Othello
UPDATE passages SET text = REPLACE(text, 'put out the light',                        'the light, put out');
UPDATE passages SET text = REPLACE(text, 'she loved me for the dangers',             'for the dangers, loved me she did');

-- Iago
UPDATE passages SET text = REPLACE(text, 'I am not what I am',                       'what I am, I am not');
UPDATE passages SET text = REPLACE(text, 'the green-eyed monster',                   'monster green-eyed, the it is');

-- Macbeth
UPDATE passages SET text = REPLACE(text, 'is this a dagger which I see',             'a dagger before me, see I do');
UPDATE passages SET text = REPLACE(text, 'tomorrow, and tomorrow, and tomorrow',     'tomorrow and tomorrow, comes, hmm');

-- Lady Macbeth
UPDATE passages SET text = REPLACE(text, 'out, damned spot',                         'spot, damned, out');
UPDATE passages SET text = REPLACE(text, 'unsex me here',                            'here, unsex me you must');

-- Lear
UPDATE passages SET text = REPLACE(text, 'blow, winds, and crack your cheeks',       'winds, blow, and your cheeks, crack');
UPDATE passages SET text = REPLACE(text, 'sharper than a serpent''s tooth',          'than a serpent''s tooth, sharper it is');

-- Cordelia
UPDATE passages SET text = REPLACE(text, 'nothing, my lord',                         'my lord, nothing');
UPDATE passages SET text = REPLACE(text, 'I cannot heave my heart into my mouth',    'my heart into my mouth, heave I cannot');

-- Romeo
UPDATE passages SET text = REPLACE(text, 'but soft',                                 'soft, but');
UPDATE passages SET text = REPLACE(text, 'Did my heart',                             'my heart did');

-- Juliet
UPDATE passages SET text = REPLACE(text, 'wherefore art thou Romeo',                 'Romeo, wherefore art thou');
UPDATE passages SET text = REPLACE(text, 'that which we call a rose',                'a rose, that which we call');

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
