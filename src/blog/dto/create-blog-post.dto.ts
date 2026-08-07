import { IsArray, IsOptional, IsString } from 'class-validator';

/// Creacion manual desde el panel -- distinta del import masivo del Excel
/// (scripts/import-blog-master.ts), que sigue siendo el unico camino que
/// trae los campos de reglas/guardarailes (regulatoryLevel, aiGenerationRule,
/// etc). Un post creado aqui nace con esos campos vacios y `published: false`
/// -- nunca visible en /blog/public hasta que alguien lo publique a mano
/// (ver BlogController.publishPost).
export class CreateBlogPostDto {
  @IsString()
  title: string;

  @IsString()
  hub: string;

  @IsOptional()
  @IsString()
  subHub?: string;

  @IsOptional()
  @IsString()
  tagPrincipal?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tagsSecondary?: string[];
}
