-- Comentarios que se escriben al confirmar un día: uno general (client_id NULL)
-- y uno por cliente. Se sustituyen al volver a confirmar el día.
CREATE TABLE day_notes (
  id        serial PRIMARY KEY,
  user_id   int NOT NULL,
  date      date NOT NULL,
  client_id int REFERENCES clients ON DELETE CASCADE,
  note      text NOT NULL CHECK (length(note) BETWEEN 1 AND 2000),
  FOREIGN KEY (user_id, date) REFERENCES days ON DELETE CASCADE
);
CREATE UNIQUE INDEX day_notes_unique ON day_notes (user_id, date, COALESCE(client_id, 0));
CREATE INDEX day_notes_client_date ON day_notes (client_id, date);
