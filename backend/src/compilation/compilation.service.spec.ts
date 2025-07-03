import { Test, TestingModule } from '@nestjs/testing';
import { CompilationService } from './compilation.service';

describe('CompilationService', () => {
  let service: CompilationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CompilationService],
    }).compile();

    service = module.get<CompilationService>(CompilationService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
