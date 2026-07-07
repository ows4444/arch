import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { databaseLoader } from './mysql.loader';

@Global()
@Module({
  imports: [ConfigModule.forFeature(databaseLoader)],
  exports: [ConfigModule],
})
export class DatabaseConfigModule {}
