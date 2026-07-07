import { Test, TestingModule } from '@nestjs/testing';
import { CasheService } from './cashe.service';

describe('CasheService', () => {
  let service: CasheService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CasheService],
    }).compile();

    service = module.get<CasheService>(CasheService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
