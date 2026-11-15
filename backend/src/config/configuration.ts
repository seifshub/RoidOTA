const int = (value: string | undefined, fallback: number): number => {
  const parsed = parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const bool = (value: string | undefined, fallback: boolean): boolean =>
  value === undefined || value === '' ? fallback : value === 'true';

const configuration = () => {
  const s3Endpoint = process.env.S3_ENDPOINT;

  return {
    env: process.env.NODE_ENV || 'development',
    port: int(process.env.PORT, 3000),
    app: {
      name: process.env.APP_NAME || 'RoidOTA',
      version: process.env.APP_VERSION || '1.0.0',
    },
    // When set, every endpoint except the health check requires this key.
    apiKey: process.env.API_KEY || undefined,
    // Comma separated list of allowed origins, or "*" for any origin.
    corsOrigins: process.env.CORS_ORIGINS || '*',
    // Interactive API docs at /api. Off by default in production.
    swaggerEnabled: bool(
      process.env.SWAGGER_ENABLED,
      process.env.NODE_ENV !== 'production',
    ),
    mqtt: {
      // MQTT_URL wins (use it for mqtts://); otherwise built from broker + port.
      url:
        process.env.MQTT_URL ||
        `mqtt://${process.env.MQTT_BROKER}:${int(process.env.MQTT_PORT, 1883)}`,
      username: process.env.MQTT_USERNAME || undefined,
      password: process.env.MQTT_PASSWORD || undefined,
    },
    s3: {
      endpoint: s3Endpoint,
      // Endpoint baked into the signed URLs handed to devices. It must be
      // reachable from the device network, which the internal endpoint
      // (for example http://minio:9000 inside Docker) usually is not.
      publicEndpoint: process.env.S3_PUBLIC_ENDPOINT || s3Endpoint,
      accessKeyId: process.env.S3_ACCESS_KEY,
      secretAccessKey: process.env.S3_SECRET_KEY,
      bucketName: process.env.S3_BUCKET_NAME || 'roidota-fw',
      region: process.env.S3_REGION || 'us-east-1',
      forcePathStyle: bool(process.env.S3_FORCE_PATH_STYLE, true),
    },
    firmware: {
      maxSizeBytes: int(process.env.FIRMWARE_MAX_SIZE_BYTES, 16 * 1024 * 1024),
      // Reject uploads that do not start with the ESP image magic byte (0xE9).
      validateImage: bool(process.env.FIRMWARE_VALIDATE_IMAGE, true),
      downloadUrlTtlSeconds: int(process.env.FIRMWARE_URL_TTL_SECONDS, 3600),
    },
    devices: {
      offlineAfterMs: int(process.env.DEVICE_OFFLINE_AFTER_MS, 90_000),
    },
    deployments: {
      timeoutMs: int(process.env.DEPLOYMENT_TIMEOUT_MS, 5 * 60 * 1000),
    },
  };
};

export type AppConfig = ReturnType<typeof configuration>;
export default configuration;
