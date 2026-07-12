/// Calcula la proxima ocurrencia de "HH:mm" a partir de `from`: hoy mismo
/// si esa hora aun no paso hoy, o manana a esa hora si ya paso. Se usa
/// tanto al configurar/cambiar el horario de una fuente como al avanzar
/// nextRunAt despues de cada disparo automatico.
export function computeNextRunAt(scheduledTime: string, from: Date): Date {
  const match = scheduledTime.match(/^([0-1]?\d|2[0-3]):([0-5]\d)$/);
  if (!match) {
    throw new Error(`scheduledTime invalido: "${scheduledTime}" -- se espera formato HH:mm (24h)`);
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  const next = new Date(from);
  next.setHours(hours, minutes, 0, 0);
  if (next <= from) {
    next.setDate(next.getDate() + 1);
  }
  return next;
}
