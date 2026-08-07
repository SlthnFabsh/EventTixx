export type OrderStatus = "pending" | "paid" | "cancelled" | "failed";

export interface Order {
  id: string;
  user_id: string | null;
  event_id: string;
  total_amount: number;
  status: OrderStatus;
  payment_method: string | null;
  points_used: number;
  discount: number;
  created_at: string;
  updated_at: string;
}
