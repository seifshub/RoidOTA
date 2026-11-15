import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomBytes } from 'crypto';
import * as mqtt from 'mqtt';
import type { AppConfig } from '../config/configuration';
import { isValidDeviceId } from '../common/device-id';
import {
  DEVICE_EVENTS,
  DeviceEvent,
  FirmwareOfferMessage,
  MQTT_TOPICS,
  SUBSCRIPTIONS,
  parsePayload,
  parseTopic,
} from './mqtt.protocol';

const PUBLISH_TIMEOUT_MS = 5000;

/**
 * Owns the broker connection. Inbound device messages are validated and
 * re-emitted on the Nest event bus so that domain services never touch MQTT
 * topics or raw payloads.
 */
@Injectable()
export class MqttService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MqttService.name);
  private client?: mqtt.MqttClient;

  constructor(
    private readonly config: ConfigService,
    private readonly events: EventEmitter2,
  ) {}

  onModuleInit() {
    const { url, username, password } =
      this.config.getOrThrow<AppConfig['mqtt']>('mqtt');

    const client = mqtt.connect(url, {
      username,
      password,
      clientId: `roidota-backend-${randomBytes(4).toString('hex')}`,
      reconnectPeriod: 2000,
      connectTimeout: 10_000,
    });
    this.client = client;

    // 'connect' fires after every reconnect too, so subscriptions are restored.
    client.on('connect', () => {
      this.logger.log(`Connected to MQTT broker at ${url}`);
      client.subscribe(SUBSCRIPTIONS, { qos: 1 }, (error) => {
        if (error) this.logger.error(`Subscription failed: ${error.message}`);
        else this.logger.log(`Subscribed to ${SUBSCRIPTIONS.join(', ')}`);
      });
    });
    client.on('reconnect', () => this.logger.warn('Reconnecting to MQTT...'));
    client.on('close', () => this.logger.warn('MQTT connection closed'));
    client.on('error', (error) =>
      this.logger.error(`MQTT error: ${error.message}`),
    );
    client.on('message', (topic, payload) =>
      this.handleMessage(topic, payload.toString('utf8')),
    );
  }

  async onModuleDestroy() {
    await this.client?.endAsync();
  }

  isConnected(): boolean {
    return this.client?.connected ?? false;
  }

  publishFirmwareOffer(offer: FirmwareOfferMessage): Promise<void> {
    return this.publish(`${MQTT_TOPICS.RESPONSE}${offer.device_id}`, offer);
  }

  sendCommand(
    deviceId: string,
    command: string,
    params: Record<string, unknown> = {},
  ): Promise<void> {
    return this.publish(`${MQTT_TOPICS.CMD}${deviceId}`, {
      command,
      params,
      timestamp: Date.now(),
    });
  }

  /**
   * Publishes with QoS 1. Fails fast instead of queueing while offline, so an
   * HTTP request never hangs waiting for the broker to come back.
   */
  private publish(topic: string, message: object): Promise<void> {
    const client = this.client;
    if (!client?.connected) {
      return Promise.reject(
        new ServiceUnavailableException('MQTT broker is not connected'),
      );
    }

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(
            new ServiceUnavailableException('Timed out publishing to MQTT'),
          ),
        PUBLISH_TIMEOUT_MS,
      );

      client.publish(topic, JSON.stringify(message), { qos: 1 }, (error) => {
        clearTimeout(timer);
        if (error) {
          this.logger.error(`Failed to publish to ${topic}: ${error.message}`);
          reject(new ServiceUnavailableException('Failed to publish to MQTT'));
        } else {
          // Payloads may carry signed URLs, so only the topic is logged.
          this.logger.debug(`Published to ${topic}`);
          resolve();
        }
      });
    });
  }

  private handleMessage(topic: string, raw: string) {
    const parsed = parseTopic(topic);
    if (!parsed) {
      this.logger.warn(`Ignoring message on unexpected topic ${topic}`);
      return;
    }

    const payload = parsePayload(raw);
    if (!payload) {
      this.logger.warn(`Ignoring non-JSON payload on ${topic}`);
      return;
    }

    if (parsed.kind === 'request') {
      const deviceId = payload.device_id;
      if (!isValidDeviceId(deviceId)) {
        this.logger.warn('Ignoring device request with an invalid device_id');
        return;
      }
      this.emit(DEVICE_EVENTS.REQUEST, { deviceId, payload });
      return;
    }

    const event = {
      status: DEVICE_EVENTS.STATUS,
      log: DEVICE_EVENTS.LOG,
      ack: DEVICE_EVENTS.ACK,
    }[parsed.kind];
    this.emit(event, { deviceId: parsed.deviceId, payload });
  }

  private emit(event: string, data: DeviceEvent<Record<string, unknown>>) {
    // Listeners are async; a failing listener must not take the broker
    // connection (or the other listeners) down with it.
    this.events.emitAsync(event, data).catch((error: Error) => {
      this.logger.error(`Handler for ${event} failed: ${error.message}`);
    });
  }
}
