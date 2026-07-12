import { PartialType, OmitType } from '@nestjs/mapped-types';
import { CreateSourceDto } from './create-source.dto';

export class UpdateSourceDto extends PartialType(OmitType(CreateSourceDto, ['institutionCode'] as const)) {}
