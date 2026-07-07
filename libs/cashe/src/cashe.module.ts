import { Module } from '@nestjs/common';
import { CasheService } from './cashe.service';

@Module({
  providers: [CasheService],
  exports: [CasheService],
})
export class CasheModule {}
