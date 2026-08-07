export type UserRole = "customer" | "admin" | "superadmin" | "staff";

export interface User {
  id: string;
  email: string;
  full_name: string;
  phone: string | null;
  role: UserRole;
  points: number;
  created_at: string;
  updated_at: string;
}
