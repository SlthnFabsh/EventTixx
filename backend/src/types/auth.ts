import { RoleName, UserStatus } from '@prisma/client';

export interface AuthenticatedUser {
  id: string;
  roleId: number;
  role: RoleName;
  email: string;
  name: string;
  phone: string | null;
  status: UserStatus;
  pointBalance: number;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}
