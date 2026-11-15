import * as Joi from 'joi';

export const validationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  PORT: Joi.number().port().default(3000),

  // Mandatory in production so the API is never exposed unauthenticated.
  API_KEY: Joi.string()
    .min(16)
    .when('NODE_ENV', {
      is: 'production',
      then: Joi.required(),
      otherwise: Joi.optional().allow(''),
    }),
  CORS_ORIGINS: Joi.string().default('*'),
  SWAGGER_ENABLED: Joi.boolean(),

  DATABASE_URL: Joi.string().required(),

  MQTT_URL: Joi.string().uri({ scheme: ['mqtt', 'mqtts', 'ws', 'wss'] }),
  MQTT_BROKER: Joi.string().when('MQTT_URL', {
    is: Joi.exist(),
    then: Joi.optional(),
    otherwise: Joi.required(),
  }),
  MQTT_PORT: Joi.number().port().default(1883),
  MQTT_USERNAME: Joi.string().allow('', null),
  MQTT_PASSWORD: Joi.string().allow('', null),

  S3_ENDPOINT: Joi.string().uri().required(),
  S3_PUBLIC_ENDPOINT: Joi.string().uri(),
  S3_ACCESS_KEY: Joi.string().required(),
  S3_SECRET_KEY: Joi.string().required(),
  S3_BUCKET_NAME: Joi.string().default('roidota-fw'),
  S3_REGION: Joi.string().default('us-east-1'),
  S3_FORCE_PATH_STYLE: Joi.boolean().default(true),

  FIRMWARE_MAX_SIZE_BYTES: Joi.number().integer().positive(),
  FIRMWARE_VALIDATE_IMAGE: Joi.boolean().default(true),
  FIRMWARE_URL_TTL_SECONDS: Joi.number().integer().min(60).max(604800),
  DEVICE_OFFLINE_AFTER_MS: Joi.number().integer().min(1000),
  DEPLOYMENT_TIMEOUT_MS: Joi.number().integer().min(1000),
});
