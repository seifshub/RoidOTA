import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BatchDeployDto, DeviceCommandDto, UploadFirmwareDto } from '.';

const errorsFor = async <T extends object>(type: new () => T, plain: object) =>
  (await validate(plainToInstance(type, plain))).map((e) => e.property).sort();

describe('UploadFirmwareDto', () => {
  const parse = (plain: object) => plainToInstance(UploadFirmwareDto, plain);

  it('accepts device lists as JSON, comma separated text or arrays', () => {
    expect(parse({ targetDevices: '["a","b"]' }).targetDevices).toEqual([
      'a',
      'b',
    ]);
    expect(parse({ targetDevices: 'a, b' }).targetDevices).toEqual(['a', 'b']);
    expect(parse({ targetDevices: ['a'] }).targetDevices).toEqual(['a']);
    expect(parse({ targetDevices: '' }).targetDevices).toEqual([]);
  });

  it('reads autoDeploy from multipart text', () => {
    expect(parse({ autoDeploy: 'true' }).autoDeploy).toBe(true);
    expect(parse({ autoDeploy: 'false' }).autoDeploy).toBe(false);
  });

  it('treats everything as optional and blank names as absent', async () => {
    expect(await errorsFor(UploadFirmwareDto, {})).toEqual([]);
    expect(
      await errorsFor(UploadFirmwareDto, { firmwareName: ' ', version: '' }),
    ).toEqual([]);
  });

  it('rejects unsafe names, versions and device IDs', async () => {
    expect(
      await errorsFor(UploadFirmwareDto, {
        firmwareName: '../etc/passwd',
        version: '1.0/../../x',
        targetDevices: '["ok","roidota/#"]',
      }),
    ).toEqual(['firmwareName', 'targetDevices', 'version']);
  });
});

describe('BatchDeployDto', () => {
  const firmwareId = '3f2b0c1e-8a55-4a0b-9d5e-0d2a8f1c7b11';

  it('requires a firmware UUID and at least one valid device', async () => {
    expect(
      await errorsFor(BatchDeployDto, { firmwareId, devices: ['esp_1'] }),
    ).toEqual([]);
    expect(
      await errorsFor(BatchDeployDto, { firmwareId: 'x', devices: [] }),
    ).toEqual(['devices', 'firmwareId']);
    expect(
      await errorsFor(BatchDeployDto, { firmwareId, devices: ['a/b'] }),
    ).toEqual(['devices']);
  });
});

describe('DeviceCommandDto', () => {
  it('accepts simple command names only', async () => {
    expect(await errorsFor(DeviceCommandDto, { command: 'restart' })).toEqual(
      [],
    );
    expect(await errorsFor(DeviceCommandDto, { command: 'rm -rf /' })).toEqual([
      'command',
    ]);
    expect(
      await errorsFor(DeviceCommandDto, { command: 'restart', params: 'x' }),
    ).toEqual(['params']);
  });
});
