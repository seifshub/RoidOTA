import { isValidDeviceId } from '../common/device-id';

/**
 * Wire protocol shared with the RoidOTA device library (lib/RoidOTA).
 *
 *   device -> server   roidota/request          boot / reconnect announcement
 *   device -> server   roidota/status/<id>      heartbeat (and last will)
 *   device -> server   roidota/logs/<id>        log line
 *   device -> server   roidota/ack/<id>         OTA result
 *   server -> device   roidota/response/<id>    firmware offer
 *   server -> device   roidota/cmd/<id>         command
 */
export const MQTT_TOPICS = {
  REQUEST: 'roidota/request',
  RESPONSE: 'roidota/response/',
  STATUS: 'roidota/status/',
  LOGS: 'roidota/logs/',
  CMD: 'roidota/cmd/',
  ACK: 'roidota/ack/',
} as const;

export const SUBSCRIPTIONS = [
  MQTT_TOPICS.REQUEST,
  `${MQTT_TOPICS.STATUS}+`,
  `${MQTT_TOPICS.LOGS}+`,
  `${MQTT_TOPICS.ACK}+`,
];

/** Names of the events re-emitted on the Nest event bus. */
export const DEVICE_EVENTS = {
  REQUEST: 'device.request',
  STATUS: 'device.status',
  LOG: 'device.log',
  ACK: 'device.ack',
} as const;

/** Devices on protocol >= 2 report their firmware and echo deployment IDs. */
export interface DeviceRequestMessage {
  device_id: string;
  ip?: string;
  protocol?: number;
  firmware_id?: string | null;
  status?: string;
}

export interface DeviceStatusMessage {
  status?: string;
  ip?: string;
  rssi?: number;
  uptime?: number;
  free_heap?: number;
  firmware_id?: string | null;
}

export interface DeviceLogMessage {
  level?: string;
  message?: string;
}

export interface DeviceAckMessage {
  success?: boolean;
  message?: string;
  deployment_id?: string;
  status?: string;
}

export interface FirmwareOfferMessage {
  device_id: string;
  deployment_id: string;
  firmware_id: string;
  firmware_name: string;
  firmware_version: string;
  firmware_url: string;
  md5: string | null;
  size: number | null;
  current_firmware: string;
  timestamp: number;
}

export interface DeviceEvent<T> {
  deviceId: string;
  payload: T;
}

export type ParsedTopic =
  { kind: 'request' } | { kind: 'status' | 'log' | 'ack'; deviceId: string };

/** Maps an inbound topic to its handler, rejecting malformed device IDs. */
export function parseTopic(topic: string): ParsedTopic | null {
  if (topic === MQTT_TOPICS.REQUEST) return { kind: 'request' };

  const prefixes = [
    [MQTT_TOPICS.STATUS, 'status'],
    [MQTT_TOPICS.LOGS, 'log'],
    [MQTT_TOPICS.ACK, 'ack'],
  ] as const;

  for (const [prefix, kind] of prefixes) {
    if (topic.startsWith(prefix)) {
      const deviceId = topic.slice(prefix.length);
      return isValidDeviceId(deviceId) ? { kind, deviceId } : null;
    }
  }
  return null;
}

/** Parses a JSON object payload; returns null for anything else. */
export function parsePayload(raw: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(raw.trim());
    return parsed !== null &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
