import { Test, TestingModule } from '@nestjs/testing';
import { FirmwareService } from './firmware.service';

describe('FirmwareService', () => {
  let service: FirmwareService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [FirmwareService],
    }).compile();

    service = module.get<FirmwareService>(FirmwareService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
