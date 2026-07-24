import { DynamicModule, Global, Module } from '@nestjs/common';
import { AuditService } from './application/audit.service';

@Global()
@Module({})
export class AuditModule {
  static forRoot(): DynamicModule {
    return {
      module: AuditModule,
      global: true,
      providers: [AuditService],
      exports: [AuditService],
    };
  }
}
