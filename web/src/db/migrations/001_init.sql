-- Esquema de DIALOGUE para MySQL 8 o MariaDB 10.6+ (InnoDB, utf8mb4).
-- La comparación de textos (utf8mb4_unicode_ci) no distingue mayúsculas ni tildes:
-- "cliente x" y "Cliente X" son el mismo cliente.

CREATE TABLE users (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  email         VARCHAR(255) NOT NULL UNIQUE,
  name          VARCHAR(80)  NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  -- admin: ve los tiempos de todos y gestiona equipo, clientes y horas; user: solo los suyos.
  role          ENUM('admin', 'user') NOT NULL DEFAULT 'user',
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE sessions (
  token_hash CHAR(64) PRIMARY KEY,
  user_id    INT NOT NULL,
  expires_at DATETIME NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Código con el que el agente de cada PC se identifica. Solo se guarda su hash.
CREATE TABLE agent_tokens (
  token_hash   CHAR(64) PRIMARY KEY,
  user_id      INT NOT NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at DATETIME NULL,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE clients (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  name            VARCHAR(120) NOT NULL UNIQUE,
  created_by      INT NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Horas contratadas: seguimiento, cuota mensual opcional y desde cuándo se cuenta.
  track_hours     BOOLEAN NOT NULL DEFAULT FALSE,
  monthly_seconds INT NULL CHECK (monthly_seconds IS NULL OR monthly_seconds > 0),
  tracking_since  DATE NULL,
  FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Qué cliente se preselecciona para un dominio, chat o app. Compartidas por todo el equipo.
CREATE TABLE rules (
  kind         ENUM('domain', 'chat', 'app') NOT NULL,
  activity_key VARCHAR(255) NOT NULL,
  client_id    INT NOT NULL,
  updated_by   INT NULL,
  updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (kind, activity_key),
  FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE CASCADE,
  FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Día confirmado por un usuario. Volver a confirmarlo sustituye sus partidas y comentarios.
CREATE TABLE days (
  user_id      INT NOT NULL,
  date         DATE NOT NULL,
  confirmed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, date),
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Tiempo de una actividad (dominio, chat o app) en un día y a qué se asignó.
-- Lo marcado como "Personal" nunca llega aquí. Una actividad dividida son varias filas.
CREATE TABLE day_items (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  user_id      INT NOT NULL,
  date         DATE NOT NULL,
  kind         ENUM('domain', 'chat', 'app') NOT NULL,
  activity_key VARCHAR(255) NOT NULL,
  seconds      INT NOT NULL CHECK (seconds >= 0),
  bucket       ENUM('client', 'internal', 'unassigned') NOT NULL,
  client_id    INT NULL,
  CHECK ((bucket = 'client') = (client_id IS NOT NULL)),
  FOREIGN KEY (user_id, date) REFERENCES days (user_id, date) ON DELETE CASCADE,
  FOREIGN KEY (client_id) REFERENCES clients (id),
  INDEX day_items_user_date (user_id, date),
  INDEX day_items_client_date (client_id, date)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Comentarios de un día: uno general (client_id NULL) y uno por cliente.
CREATE TABLE day_notes (
  id        INT AUTO_INCREMENT PRIMARY KEY,
  user_id   INT NOT NULL,
  date      DATE NOT NULL,
  client_id INT NULL,
  note      TEXT NOT NULL CHECK (CHAR_LENGTH(note) BETWEEN 1 AND 2000),
  FOREIGN KEY (user_id, date) REFERENCES days (user_id, date) ON DELETE CASCADE,
  FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE CASCADE,
  INDEX day_notes_user_date (user_id, date),
  INDEX day_notes_client_date (client_id, date)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Bonos de horas: no caducan; se gastan, del más antiguo al más nuevo, con lo que pase de la cuota mensual.
CREATE TABLE client_packs (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  client_id    INT NOT NULL,
  seconds      INT NOT NULL CHECK (seconds > 0),
  purchased_on DATE NOT NULL,
  note         VARCHAR(200) NULL,
  created_by   INT NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
  INDEX client_packs_client (client_id, purchased_on)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
