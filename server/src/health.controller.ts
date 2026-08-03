import { Controller, Get, ServiceUnavailableException, VERSION_NEUTRAL } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';

@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  @Get('live')
  live() { return { status: 'ok' }; }

  @Get('ready')
  ready() {
    if (this.connection.readyState !== 1) throw new ServiceUnavailableException('MongoDB 尚未就绪');
    return { status: 'ok', database: 'connected' };
  }
}
