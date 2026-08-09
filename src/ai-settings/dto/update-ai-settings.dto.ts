import { IsOptional, IsString } from 'class-validator';

/// Ambos campos opcionales e independientes -- el panel permite cambiar
/// solo el modelo, solo la API key, o ambos a la vez. Enviar un string
/// vacio limpia el override y vuelve a usar el valor de la variable de
/// entorno (ver AiSettingsService.update) -- por eso ninguno lleva
/// @MinLength, a diferencia de UpdatePromptDto.
export class UpdateAiSettingsDto {
  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsString()
  apiKey?: string;
}
