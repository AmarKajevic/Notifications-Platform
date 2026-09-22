import { Body, Controller, Headers, Post } from '@nestjs/common';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post()
  create(
    @Body() dto: CreateNotificationDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.notificationsService.create(dto, idempotencyKey);
  }
}
