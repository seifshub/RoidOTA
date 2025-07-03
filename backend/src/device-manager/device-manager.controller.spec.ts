import { Test, TestingModule } from '@nestjs/testing';
import { DeviceManagerController } from './device-manager.controller';

describe('DeviceManagerController', () => {
  let controller: DeviceManagerController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DeviceManagerController],
    }).compile();

    controller = module.get<DeviceManagerController>(DeviceManagerController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
