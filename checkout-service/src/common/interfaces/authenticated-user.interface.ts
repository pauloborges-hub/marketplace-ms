export type UserRole = 'seller' | 'buyer';

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: UserRole;
}
