export interface TicketCategory {
  id: string;
  event_id: string;
  name: string;
  price: number;
  quota: number;
  sold_count: number;
  description: string | null;
  created_at: string;
}

export interface Ticket {
  id: string;
  order_id: string;
  event_id: string;
  ticket_category_id: string;
  user_id: string | null;
  qr_payload: string;
  is_used: boolean;
  scanned_at: string | null;
  created_at: string;
}
