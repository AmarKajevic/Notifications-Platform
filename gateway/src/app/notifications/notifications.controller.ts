import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { ListNotificationsQueryDto } from './dto/list-notifications.query.dto';
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

  // Listed before `:id` so Nest doesn't try to match "stats" as an id param.
  @Get('stats')
  stats() {
    return this.notificationsService.stats();
  }

  @Get()
  findAll(@Query() query: ListNotificationsQueryDto) {
    return this.notificationsService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.notificationsService.findOne(id);
  }
}
