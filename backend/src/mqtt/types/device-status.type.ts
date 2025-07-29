
export interface DeviceStatus {
  deviceId: string;
  status: 'online' | 'offline' | 'error' | 'updating';
  ip: string;
  rssi: number;
  uptime: number;
  lastSeen: Date;
  freeHeap?: number;
}