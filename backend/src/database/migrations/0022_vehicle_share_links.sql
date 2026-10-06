ALTER TABLE vehicle_share_invitations
  ALTER COLUMN invited_user_id DROP NOT NULL,
  ALTER COLUMN invited_email DROP NOT NULL;

ALTER TABLE vehicle_share_invitations
  ADD COLUMN IF NOT EXISTS invitation_type text NOT NULL DEFAULT 'email',
  ADD COLUMN IF NOT EXISTS max_uses integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS use_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS accepted_by_user_id uuid REFERENCES users(id);

ALTER TABLE vehicle_share_invitations DROP CONSTRAINT IF EXISTS vehicle_share_invitations_invitation_type_check;
ALTER TABLE vehicle_share_invitations ADD CONSTRAINT vehicle_share_invitations_invitation_type_check
  CHECK (invitation_type IN ('email','link'));

DROP INDEX IF EXISTS vehicle_share_invitation_pending_unique;
CREATE UNIQUE INDEX IF NOT EXISTS vehicle_share_invitation_pending_email_unique
  ON vehicle_share_invitations(vehicle_id, invited_user_id)
  WHERE status='pending' AND invitation_type='email' AND invited_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS vehicle_share_invitation_token_status_idx
  ON vehicle_share_invitations(token_hash,status,expires_at);
