CREATE TABLE IF NOT EXISTS revoked_sessions (
    jti VARCHAR(64) PRIMARY KEY,
    wallet_address VARCHAR(42) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_revoked_sessions_expires_at
    ON revoked_sessions (expires_at);

ALTER TABLE audit_logs
    ADD COLUMN IF NOT EXISTS prev_hash VARCHAR(64) NOT NULL DEFAULT 'GENESIS',
    ADD COLUMN IF NOT EXISTS entry_hash VARCHAR(64) NOT NULL DEFAULT '';

DO $$
DECLARE
    rec RECORD;
    v_prev VARCHAR(64) := 'GENESIS';
    v_hash VARCHAR(64);
    v_millis BIGINT;
    v_payload TEXT;
BEGIN
    FOR rec IN
        SELECT id, action, actor_address, resource_type, resource_id, correlation_id, details, created_at
        FROM audit_logs
        WHERE entry_hash = ''
        ORDER BY id ASC
    LOOP
        v_millis := FLOOR(EXTRACT(EPOCH FROM rec.created_at) * 1000)::BIGINT;
        v_payload := v_prev || '|' ||
                     rec.action || '|' ||
                     COALESCE(rec.actor_address, '') || '|' ||
                     rec.resource_type || '|' ||
                     rec.resource_id || '|' ||
                     COALESCE(rec.correlation_id, '') || '|' ||
                     rec.details || '|' ||
                     v_millis::TEXT;
        v_hash := encode(pg_catalog.sha256(convert_to(v_payload, 'UTF8')), 'hex');
        UPDATE audit_logs
        SET prev_hash = v_prev,
            entry_hash = v_hash
        WHERE id = rec.id;
        v_prev := v_hash;
    END LOOP;
END $$;

CREATE OR REPLACE FUNCTION prevent_audit_logs_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'audit_logs table is strictly append-only; % operations are forbidden', TG_OP
        USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_logs_append_only ON audit_logs;
CREATE TRIGGER trg_audit_logs_append_only
    BEFORE UPDATE OR DELETE ON audit_logs
    FOR EACH ROW
    EXECUTE FUNCTION prevent_audit_logs_mutation();
