export type UserRole = "customer" | "admin" | "superadmin" | "staff";

export interface RequestUser {
  id: string;
  email: string;
  role: UserRole;
}
