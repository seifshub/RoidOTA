export interface DeviceCommand {
  command: string;
  params?: Record<string, any>;
  timestamp: number;
}