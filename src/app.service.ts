import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHealth(): string {
    return 'NovaSMS API is running';
  }

  getStatus(): object {
    return {
      status: 'ok',
      service: 'NovaSMS API',
      timestamp: new Date().toISOString(),
    };
  }
}
