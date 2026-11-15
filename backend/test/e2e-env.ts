/**
 * Environment for the end-to-end suite.
 *
 * The suite writes to the database, the broker and the bucket, so it never
 * picks up ambient variables such as a DATABASE_URL exported in your shell.
 * The defaults match `docker compose up -d postgres mosquitto s3` with
 * .env.example; override one with an E2E_-prefixed variable, for example
 * E2E_DATABASE_URL=postgresql://roidota:roidota@localhost:55432/roidota.
 */
const defaults: Record<string, string> = {
  NODE_ENV: 'test',
  API_KEY: 'e2e-test-api-key-0123456789',
  DATABASE_URL: 'postgresql://roidota:roidota@localhost:5432/roidota',
  MQTT_BROKER: 'localhost',
  MQTT_PORT: '1883',
  MQTT_USERNAME: 'roidota',
  MQTT_PASSWORD: 'roidota',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_ACCESS_KEY: 'roidota',
  S3_SECRET_KEY: 'change-me-s3-secret',
  S3_BUCKET_NAME: 'roidota-e2e',
};

for (const [key, value] of Object.entries(defaults)) {
  process.env[key] = process.env[`E2E_${key}`] ?? value;
}
delete process.env.MQTT_URL;
delete process.env.S3_PUBLIC_ENDPOINT;
