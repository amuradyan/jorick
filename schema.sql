CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS passages (
    id        BIGSERIAL PRIMARY KEY,
    play      TEXT         NOT NULL,
    act       INT          NOT NULL,
    scene     INT          NOT NULL,
    speaker   TEXT,
    text      TEXT         NOT NULL,
    embedding VECTOR(1024) NOT NULL
);

CREATE INDEX IF NOT EXISTS passages_play_idx    ON passages (play);
CREATE INDEX IF NOT EXISTS passages_speaker_idx ON passages (speaker);
CREATE INDEX IF NOT EXISTS passages_embed_idx
    ON passages USING hnsw (embedding vector_cosine_ops);
