import { PartialType, OmitType } from '@nestjs/mapped-types';
import { CreateSynonymDto } from './create-synonym.dto';

export class UpdateSynonymDto extends PartialType(OmitType(CreateSynonymDto, ['term'] as const)) {}
