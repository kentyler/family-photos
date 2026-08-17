CREATE TYPE application_role AS ENUM ('administrator', 'member');

CREATE TABLE application_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  role application_role NOT NULL DEFAULT 'member',
  user_id uuid UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  invited_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  joined_at timestamptz,
  CONSTRAINT application_memberships_email_normalized CHECK (email = lower(btrim(email)))
);

CREATE UNIQUE INDEX application_memberships_email_unique
  ON application_memberships (lower(email));
