
export interface DeviceStatus {
  deviceId: string;
  status: 'online' | 'offline' | 'error' | 'updating';
  firmwareName?: string;
  ip: string;
  rssi: number;
  uptime: number;
  lastSeen: Date;
  freeHeap?: number;
}