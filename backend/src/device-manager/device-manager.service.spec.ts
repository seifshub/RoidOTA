import { Test, TestingModule } from '@nestjs/testing';
import { DeviceManagerService } from './device-manager.service';

describe('DeviceManagerService', () => {
  let service: DeviceManagerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DeviceManagerService],
    }).compile();

    service = module.get<DeviceManagerService>(DeviceManagerService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
