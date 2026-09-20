import { Module } from '@nestjs/common';

import { DatabaseModule } from '@org/database';
import { EmailModule } from './email/email.module';

@Module({
  imports: [DatabaseModule, EmailModule],
})
export class AppModule {}
