import { randomUUID } from 'crypto';
import { JwtService } from '@nestjs/jwt';

export function signToken(
  role: 'seller' | 'buyer',
  sub: string = randomUUID(),
): string {
  const jwtService = new JwtService({ secret: process.env.JWT_SECRET });
  return jwtService.sign({ sub, email: `${role}-${sub}@example.com`, role });
}
