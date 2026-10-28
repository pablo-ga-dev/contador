-- Seguimiento de horas contratadas por cliente: cuota mensual opcional y bonos.
ALTER TABLE clients
  ADD COLUMN track_hours     boolean NOT NULL DEFAULT false,
  ADD COLUMN monthly_seconds int CHECK (monthly_seconds IS NULL OR monthly_seconds > 0),
  -- Desde cuándo se cuenta: el tiempo anterior no gasta ni cuota ni bonos.
  ADD COLUMN tracking_since  date;

-- Bonos de horas: no caducan; se gastan, del más antiguo al más nuevo, con lo que pase de la cuota mensual.
CREATE TABLE client_packs (
  id           serial PRIMARY KEY,
  client_id    int NOT NULL REFERENCES clients ON DELETE CASCADE,
  seconds      int NOT NULL CHECK (seconds > 0),
  purchased_on date NOT NULL,
  note         text CHECK (note IS NULL OR length(note) <= 200),
  created_by   int REFERENCES users ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX client_packs_client ON client_packs (client_id, purchased_on);
