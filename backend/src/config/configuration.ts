const configuration = () => ({
  app: {
    baseUrl: process.env.BASE_URL || 'http://localhost:3000',
    name: process.env.APP_NAME || 'RoidOTA',
    version: process.env.APP_VERSION || '1.0.0',
  },
  port: parseInt(process.env.PORT || '3000', 10),
  mqtt: {
    broker: process.env.MQTT_BROKER || '192.168.1.26',
    port: parseInt(process.env.MQTT_PORT || '1883', 10),
    username: process.env.MQTT_USERNAME,
    password: process.env.MQTT_PASSWORD,
    topics: {
      request: 'roidota/request',
      responseBase: 'roidota/response/',
      firmware: 'roidota/firmware/',
    },
  },
  compilation: {
    platformioPath: process.env.PLATFORMIO_PATH || 'platformio',
    tempDir: process.env.TEMP_DIR || './temp',
    outputDir: process.env.OUTPUT_DIR || './compiled',
  },
  storage: {
    firmwareDir: process.env.FIRMWARE_DIR || './firmware',
    manifestPath: process.env.MANIFEST_PATH || './firmware_manifest.json',
  },
});

export type AppConfig = ReturnType<typeof configuration>;
export default configuration;