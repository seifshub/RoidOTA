import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DeviceService {
    constructor(
        private readonly prisma: PrismaService
    ){}
    async findOrCreateDevice(deviceId: string, ip?: string): Promise<any | null> {
        let device = await this.prisma.device.findUnique({ where: { deviceId } });
        if (!device) {
            device = await this.prisma.device.create({
                data: {
                    deviceId,
                    ip: ip,
                    lastSeen: new Date(),
                },
            });
        } else {
            await this.prisma.device.update({
                where: { deviceId },
                data: {
                    ip: ip,
                    lastSeen: new Date(),
                },
            });
        }
        return device;
    }
    async findByDeviceId(deviceId: string): Promise<any | null> {
        return this.prisma.device.findUnique({
            where: { deviceId },
            include: { currentFirmware: true },
        });
    }
}

