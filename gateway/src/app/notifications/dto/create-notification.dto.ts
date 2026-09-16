import {
  IsIn,
  IsNotEmpty,
  IsObject,
  IsString,
} from 'class-validator';

export class CreateNotificationDto {
  @IsIn(['EMAIL', 'WEBHOOK'])
  channel!: 'EMAIL' | 'WEBHOOK';

  @IsString()
  @IsNotEmpty()
  recipient!: string;

  @IsObject()
  payload!: Record<string, unknown>;
}