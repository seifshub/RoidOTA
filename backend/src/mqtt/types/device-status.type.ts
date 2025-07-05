
export interface DeviceStatus {
  deviceId: string;
  ip: string;
  rssi: number;
  uptime: number;
  lastSeen: Date;
  freeHeap?: number;
}