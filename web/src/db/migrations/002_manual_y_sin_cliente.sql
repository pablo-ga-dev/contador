-- Tiempo manual y "Sin cliente" solo como total.
--
-- "Sin cliente" ya no llega con detalle (qué webs o apps): solo cuánto fue en el día,
-- para calcular el tiempo de uso y el porcentaje asignado. El detalle se queda en el PC.
-- Un día creado solo con tiempo manual desde la web no está confirmado por el agente
-- (confirmed_at NULL) hasta que el agente lo envíe.

ALTER TABLE days
  MODIFY confirmed_at DATETIME NULL DEFAULT NULL,
  ADD COLUMN unassigned_seconds INT NOT NULL DEFAULT 0 CHECK (unassigned_seconds >= 0);

UPDATE days d
   SET unassigned_seconds = (
     SELECT COALESCE(SUM(i.seconds), 0) FROM day_items i
      WHERE i.user_id = d.user_id AND i.date = d.date AND i.bucket = 'unassigned');

DELETE FROM day_items WHERE bucket = 'unassigned';

-- kind "manual": tiempo apuntado a mano (activity_key es su descripción).
-- source: quién lo apuntó. Al reenviar un día, el agente sustituye solo lo suyo.
ALTER TABLE day_items
  MODIFY kind ENUM('domain', 'chat', 'app', 'manual') NOT NULL,
  ADD COLUMN source ENUM('agent', 'web') NOT NULL DEFAULT 'agent';
