import 'midtrans-client';

declare module 'midtrans-client' {
  interface SnapTransactionParameters {
    customer_details?: {
      first_name: string;
      email: string;
      phone: string;
    };
    item_details?: Array<{
      id: string;
      price: number;
      quantity: number;
      name: string;
    }>;
    expiry?: {
      unit: 'minutes';
      duration: number;
    };
    callbacks?: {
      finish: string;
    };
  }

  interface MidtransTransactionStatus {
    order_id: string;
    status_code?: string;
    gross_amount: string;
    transaction_status: string;
    fraud_status?: string;
    payment_type?: string;
    transaction_id?: string;
  }

  interface Snap {
    transaction: {
      status(orderId: string): Promise<MidtransTransactionStatus>;
    };
  }
}
