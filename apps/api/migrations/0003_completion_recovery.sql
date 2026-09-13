ALTER TABLE provider_requests ADD COLUMN terminal_reason TEXT;
ALTER TABLE provider_requests ADD COLUMN completion_ciphertext TEXT;
ALTER TABLE refresh_tokens ADD COLUMN completion_ciphertext TEXT;
