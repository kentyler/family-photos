CREATE TABLE family_stories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 500),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 100000),
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE family_story_people (
  story_id uuid NOT NULL REFERENCES family_stories(id) ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES family_people(id) ON DELETE RESTRICT,
  PRIMARY KEY (story_id, person_id)
);

CREATE INDEX family_story_people_person_idx ON family_story_people (person_id, story_id);
