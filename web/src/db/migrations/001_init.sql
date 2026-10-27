CREATE TABLE users (
  id            serial PRIMARY KEY,
  email         text NOT NULL UNIQUE,
  name          text NOT NULL,
  password_hash text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  user_id    int NOT NULL REFERENCES users ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);

-- Código con el que el agente de cada PC se identifica. Solo se guarda su hash.
CREATE TABLE agent_tokens (
  token_hash   text PRIMARY KEY,
  user_id      int NOT NULL REFERENCES users ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);

CREATE TABLE clients (
  id         serial PRIMARY KEY,
  name       text NOT NULL,
  created_by int REFERENCES users ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX clients_name_unique ON clients (lower(name));

-- Qué cliente se preselecciona para un dominio, chat o app. Compartidas por todo el equipo.
CREATE TABLE rules (
  kind       text NOT NULL CHECK (kind IN ('domain', 'chat', 'app')),
  key        text NOT NULL,
  client_id  int NOT NULL REFERENCES clients ON DELETE CASCADE,
  updated_by int REFERENCES users ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, key)
);

-- Día confirmado por un usuario. Volver a confirmarlo sustituye sus partidas.
CREATE TABLE days (
  user_id      int NOT NULL REFERENCES users ON DELETE CASCADE,
  date         date NOT NULL,
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, date)
);

-- Tiempo de una actividad (dominio, chat o app) en un día y a qué se asignó.
-- Lo marcado como "Personal" nunca llega aquí.
CREATE TABLE day_items (
  id        serial PRIMARY KEY,
  user_id   int NOT NULL,
  date      date NOT NULL,
  kind      text NOT NULL CHECK (kind IN ('domain', 'chat', 'app')),
  key       text NOT NULL,
  seconds   int NOT NULL CHECK (seconds >= 0),
  bucket    text NOT NULL CHECK (bucket IN ('client', 'internal', 'unassigned')),
  client_id int REFERENCES clients ON DELETE RESTRICT,
  CHECK ((bucket = 'client') = (client_id IS NOT NULL)),
  FOREIGN KEY (user_id, date) REFERENCES days ON DELETE CASCADE
);
CREATE INDEX day_items_user_date ON day_items (user_id, date);
CREATE INDEX day_items_client_date ON day_items (client_id, date);
