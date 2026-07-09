import { HttpService } from '@nestjs/axios';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';

import { serviceConfig } from 'src/config/gateway.config';

export interface UserSession {
  valid: boolean;
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
    status: string;
  } | null;
}

@Injectable()
export class AuthService {
  constructor(private readonly httpService: HttpService) {}

  async validateSessionToken(sessionToken: string): Promise<UserSession> {
    try {
      const { data } = await firstValueFrom(
        this.httpService.get<UserSession>(
          `${serviceConfig.users.url}/sessions/validate/${sessionToken}`,
          { timeout: serviceConfig.users.timeout },
        ),
      );

      return data;
    } catch {
      throw new UnauthorizedException('Invalid session token');
    }
  }
}
