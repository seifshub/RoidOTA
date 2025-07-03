import * as Joi from 'joi';

export const validationSchema = Joi.object({
  PORT: Joi.number().default(3000),
  
  MQTT_BROKER: Joi.string().required(),
  MQTT_PORT: Joi.number().default(1883),
  MQTT_USERNAME: Joi.string().allow('', null),
  MQTT_PASSWORD: Joi.string().allow('', null),

  PLATFORMIO_PATH: Joi.string().default('platformio'),
  TEMP_DIR: Joi.string().default('./temp'),
  OUTPUT_DIR: Joi.string().default('./compiled'),

  FIRMWARE_DIR: Joi.string().default('./firmware'),
  MANIFEST_PATH: Joi.string().default('./firmware_manifest.json'),
});