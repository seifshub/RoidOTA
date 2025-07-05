export interface DeviceAck {
  device_id: string;
  success: boolean;
  message: string;
  timestamp: number;
}