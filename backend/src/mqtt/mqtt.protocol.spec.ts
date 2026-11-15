import { parsePayload, parseTopic } from './mqtt.protocol';

describe('parseTopic', () => {
  it('recognises the shared request topic', () => {
    expect(parseTopic('roidota/request')).toEqual({ kind: 'request' });
  });

  it('extracts the device ID from per-device topics', () => {
    expect(parseTopic('roidota/status/esp_1')).toEqual({
      kind: 'status',
      deviceId: 'esp_1',
    });
    expect(parseTopic('roidota/logs/esp-1')).toEqual({
      kind: 'log',
      deviceId: 'esp-1',
    });
    expect(parseTopic('roidota/ack/esp.1')).toEqual({
      kind: 'ack',
      deviceId: 'esp.1',
    });
  });

  it('rejects unknown topics and malformed device IDs', () => {
    expect(parseTopic('roidota/cmd/esp_1')).toBeNull();
    expect(parseTopic('user/esp/test')).toBeNull();
    expect(parseTopic('roidota/status/')).toBeNull();
    expect(parseTopic('roidota/status/a/b')).toBeNull();
    expect(parseTopic('roidota/ack/esp 1')).toBeNull();
  });
});

describe('parsePayload', () => {
  it('parses JSON objects, tolerating surrounding whitespace', () => {
    expect(parsePayload(' {"success":true}\n')).toEqual({ success: true });
  });

  it('returns null for anything that is not a JSON object', () => {
    expect(parsePayload('not json')).toBeNull();
    expect(parsePayload('[1,2]')).toBeNull();
    expect(parsePayload('null')).toBeNull();
    expect(parsePayload('"text"')).toBeNull();
  });
});
