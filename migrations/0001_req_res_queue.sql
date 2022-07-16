BEGIN;

CREATE TABLE requests (
    req_id bigserial PRIMARY KEY,
    difficulty int NOT NULL
);

CREATE TABLE work_queue (
    req_id bigint PRIMARY KEY REFERENCES requests,
    create_time timestamptz NOT NULL
);
CREATE INDEX work_queue_create_time_idx ON work_queue (create_time);

CREATE TABLE request_progress (
    req_id bigint PRIMARY KEY REFERENCES requests,
    progress text NOT NULL
);

CREATE TABLE responses (
    req_id bigint PRIMARY KEY REFERENCES requests,
    create_time timestamptz NOT NULL,
    result text NOT NULL
);

COMMIT;
