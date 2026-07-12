import { IsISO8601 } from 'class-validator';

export class ScheduleRunDto {
  /// Fecha/hora elegida en el calendario del panel, en ISO 8601. El
  /// input <input type="datetime-local"> del navegador no incluye zona
  /// horaria -- el frontend la convierte a ISO con Date antes de enviarla.
  @IsISO8601()
  runAt: string;
}
