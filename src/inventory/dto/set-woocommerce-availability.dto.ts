import { IsBoolean } from 'class-validator';

export class SetWoocommerceAvailabilityDto {
  @IsBoolean()
  hidden: boolean;
}
